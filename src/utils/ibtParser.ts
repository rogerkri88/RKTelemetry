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

export function parseIBT(arrayBuffer: ArrayBuffer, fileName: string): ParsedIBT {
  const view = new DataView(arrayBuffer);

  const numVars = view.getInt32(12, true);
  const varHeaderOffset = view.getInt32(16, true);
  const bufCount = view.getInt32(20, true);
  const bufLen = view.getInt32(24, true);
  const bufOffset = view.getInt32(52, true);

  const vars: { name: string; offset: number }[] = [];

  for (let i = 0; i < numVars; i++) {
    const offset = varHeaderOffset + i * 144;
    const varOffset = view.getInt32(offset + 4, true);

    let name = '';
    for (let j = 0; j < 32; j++) {
      const charCode = view.getUint8(offset + 16 + j);
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }
    vars.push({ name, offset: varOffset });
  }

  const findVar = (name: string) => vars.find((v) => v.name === name);

  const lapVar = findVar('Lap');
  const lapDistVar = findVar('LapDist');
  const speedVar = findVar('Speed');
  const throttleVar = findVar('Throttle');
  const brakeVar = findVar('Brake');
  const steerVar = findVar('SteeringWheelAngle');
  const gearVar = findVar('Gear');
  const rpmVar = findVar('RPM');

  const laps: LapData[] = [];
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

    const rawLap = lapVar ? view.getInt32(frameOffset + lapVar.offset, true) : 1;
    const dist = lapDistVar ? view.getFloat32(frameOffset + lapDistVar.offset, true) : i * 0.5;

    // Detect lap boundary: explicit Lap increase OR LapDist drop from > 500m to < 100m
    const distReset = lastDist > 500 && dist < 100 && dist >= 0;
    const lapChanged = rawLap > currentLapNum && rawLap > 0;

    if ((distReset || lapChanged) && activeLap.sampleCount > 300) {
      laps.push(activeLap);
      currentLapNum = lapChanged ? rawLap : currentLapNum + 1;
      activeLap = createNewLap(currentLapNum);
    }

    lastDist = dist;

    const speed = speedVar ? view.getFloat32(frameOffset + speedVar.offset, true) * 3.6 : 0;
    const throttle = throttleVar ? view.getFloat32(frameOffset + throttleVar.offset, true) * 100 : 0;
    const brake = brakeVar ? view.getFloat32(frameOffset + brakeVar.offset, true) * 100 : 0;
    const steer = steerVar ? (view.getFloat32(frameOffset + steerVar.offset, true) * 180) / Math.PI : 0;
    const gear = gearVar ? view.getInt32(frameOffset + gearVar.offset, true) : 0;
    const rpm = rpmVar ? view.getFloat32(frameOffset + rpmVar.offset, true) : 0;

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
    laps.push(activeLap);
  }

  // Ensure X-axis is strictly monotonic for uPlot
  const sanitizedLaps = laps.map((lap) => {
    const cleanDist: number[] = [];
    let currentMax = -1;

    for (let i = 0; i < lap.lapDist.length; i++) {
      let d = lap.lapDist[i];
      if (d <= currentMax) {
        d = currentMax + 0.01; // Force strictly increasing step
      }
      currentMax = d;
      cleanDist.push(d);
    }

    return { ...lap, lapDist: cleanDist };
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