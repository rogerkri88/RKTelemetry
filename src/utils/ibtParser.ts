export interface LapData {
  lapNum: number;
  sampleCount: number;
  lapDist: number[];
  speed: number[];      // km/h
  throttle: number[];   // %
  brake: number[];      // %
  steering: number[];   // deg
  gear: number[];
  rpm: number[];
  time: number[];       // seconds
}

export interface ParsedIBT {
  fileName: string;
  channelsAvailable: string[];
  laps: LapData[];
}

// iRacing Data Types (irsdk_VarType)
// 0 = char, 1 = bool, 2 = int32, 3 = bitfield, 4 = float32, 5 = float64
function readVarValue(view: DataView, offset: number, type: number): number {
  switch (type) {
    case 1: // bool
      return view.getUint8(offset);
    case 2: // int32
    case 3: // bitfield
      return view.getInt32(offset, true);
    case 4: // float32
      return view.getFloat32(offset, true);
    case 5: // float64
      return view.getFloat64(offset, true);
    default:
      return 0;
  }
}

export function parseIBT(arrayBuffer: ArrayBuffer, fileName: string): ParsedIBT {
  const view = new DataView(arrayBuffer);

  const numVars = view.getInt32(12, true);
  const varHeaderOffset = view.getInt32(16, true);
  const bufCount = view.getInt32(20, true);
  const bufLen = view.getInt32(24, true);
  const bufOffset = view.getInt32(52, true);

  const vars: { name: string; offset: number; type: number }[] = [];

  for (let i = 0; i < numVars; i++) {
    const headerPos = varHeaderOffset + i * 144;
    const type = view.getInt32(headerPos, true);
    const varOffset = view.getInt32(headerPos + 4, true);

    let name = '';
    for (let j = 0; j < 32; j++) {
      const charCode = view.getUint8(headerPos + 16 + j);
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }
    vars.push({ name, offset: varOffset, type });
  }

  const findVar = (name: string) => vars.find((v) => v.name === name);

  const lapVar = findVar('Lap');
  const lapDistVar = findVar('LapDist');
  const lapDistPctVar = findVar('LapDistPct');
  const speedVar = findVar('Speed');
  const throttleVar = findVar('Throttle');
  const brakeVar = findVar('Brake');
  const steerVar = findVar('SteeringWheelAngle');
  const gearVar = findVar('Gear');
  const rpmVar = findVar('RPM');

  const rawLaps: LapData[] = [];
  let currentLapNum = 1;
  let lastDist = -1;

  function createNewLap(num: number): LapData {
    return {
      lapNum: num,
      sampleCount: 0,
      lapDist: [],
      speed: [],
      throttle: [],
      brake: [],
      steering: [],
      gear: [],
      rpm: [],
      time: [],
    };
  }

  let activeLap = createNewLap(currentLapNum);
  const sampleRate = 1 / 60;

  for (let i = 0; i < bufCount; i++) {
    const frameOffset = bufOffset + i * bufLen;

    const rawLap = lapVar ? readVarValue(view, frameOffset + lapVar.offset, lapVar.type) : 1;
    
    let dist = -1;
    if (lapDistVar) {
      dist = readVarValue(view, frameOffset + lapDistVar.offset, lapDistVar.type);
    } else if (lapDistPctVar) {
      const pct = readVarValue(view, frameOffset + lapDistPctVar.offset, lapDistPctVar.type);
      if (pct >= 0) dist = pct * 4250;
    }

    // Boundary check:
    // 1. Lap counter explicitly incremented
    // 2. LapDist reset (distance was >150m and suddenly dropped by >100m)
    const lapVarBumped = rawLap > currentLapNum && rawLap > 0;
    const distReset = lastDist > 150 && dist >= 0 && (lastDist - dist > 100);

    if ((lapVarBumped || distReset) && activeLap.sampleCount > 300) {
      rawLaps.push(activeLap);
      currentLapNum = lapVarBumped ? rawLap : currentLapNum + 1;
      activeLap = createNewLap(currentLapNum);
    }

    if (dist >= 0) {
      lastDist = dist;
    }

    const speed = speedVar ? readVarValue(view, frameOffset + speedVar.offset, speedVar.type) * 3.6 : 0;
    const throttle = throttleVar ? readVarValue(view, frameOffset + throttleVar.offset, throttleVar.type) * 100 : 0;
    const brake = brakeVar ? readVarValue(view, frameOffset + brakeVar.offset, brakeVar.type) * 100 : 0;
    const steer = steerVar ? (readVarValue(view, frameOffset + steerVar.offset, steerVar.type) * 180) / Math.PI : 0;
    const gear = gearVar ? readVarValue(view, frameOffset + gearVar.offset, gearVar.type) : 0;
    const rpm = rpmVar ? readVarValue(view, frameOffset + rpmVar.offset, rpmVar.type) : 0;

    activeLap.lapDist.push(dist >= 0 ? dist : activeLap.sampleCount * 0.5);
    activeLap.speed.push(speed);
    activeLap.throttle.push(throttle);
    activeLap.brake.push(brake);
    activeLap.steering.push(steer);
    activeLap.gear.push(gear);
    activeLap.rpm.push(rpm);
    activeLap.time.push(activeLap.sampleCount * sampleRate);

    activeLap.sampleCount++;
  }

  if (activeLap.sampleCount > 300) {
    rawLaps.push(activeLap);
  }

  // Ensure X-axis distance array is strictly monotonic (increasing) for uPlot
  const sanitizedLaps = rawLaps.map((lap, index) => {
    const cleanDist: number[] = [];
    let currentMax = -1;

    for (let i = 0; i < lap.lapDist.length; i++) {
      let d = lap.lapDist[i];
      if (d <= currentMax) {
        d = currentMax + 0.001;
      }
      currentMax = d;
      cleanDist.push(d);
    }

    return {
      ...lap,
      lapNum: index + 1,
      lapDist: cleanDist,
    };
  });

  return {
    fileName,
    channelsAvailable: ['Speed', 'Throttle', 'Brake', 'Steering', 'Gear', 'RPM', 'Time Delta'],
    laps: sanitizedLaps,
  };
}

export function calculateTimeDelta(refLap: LapData, compLap: LapData): number[] {
  const delta: number[] = [];
  const len = compLap.lapDist.length;

  for (let i = 0; i < len; i++) {
    const compTime = compLap.time[i];
    const refIdx = Math.min(i, refLap.time.length - 1);
    const refTime = refLap.time[refIdx] || 0;
    delta.push(compTime - refTime);
  }

  return delta;
}