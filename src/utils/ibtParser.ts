export interface TelemetryChannel {
  name: string;
  unit: string;
  data: number[];
}

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
  time: number[];       // seconds from start of lap
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

  const vars: { name: string; type: number; offset: number; unit: string }[] = [];

  for (let i = 0; i < numVars; i++) {
    const offset = varHeaderOffset + i * 144;
    const type = view.getInt32(offset, true);
    const varOffset = view.getInt32(offset + 4, true);

    let name = '';
    for (let j = 0; j < 32; j++) {
      const charCode = view.getUint8(offset + 16 + j);
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }

    let unit = '';
    for (let j = 0; j < 32; j++) {
      const charCode = view.getUint8(offset + 48 + j);
      if (charCode === 0) break;
      unit += String.fromCharCode(charCode);
    }

    vars.push({ name, type, offset: varOffset, unit });
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

  // Temporary storage per lap
  const lapMap = new Map<number, LapData>();

  let sampleTimeCounter = 0;
  const sampleRate = 1 / 60; // 60 Hz iRacing telemetry rate

  for (let i = 0; i < bufCount; i++) {
    const frameOffset = bufOffset + i * bufLen;

    const currentLap = lapVar ? view.getInt32(frameOffset + lapVar.offset, true) : 1;
    if (currentLap <= 0) continue; // Ignore warm-up / pit exit frames before Lap 1

    if (!lapMap.has(currentLap)) {
      lapMap.set(currentLap, {
        lapNum: currentLap,
        sampleCount: 0,
        lapDist: [],
        speed: [],
        throttle: [],
        brake: [],
        steering: [],
        gear: [],
        rpm: [],
        time: [],
      });
      sampleTimeCounter = 0;
    }

    const lapData = lapMap.get(currentLap)!;

    const dist = lapDistVar ? view.getFloat32(frameOffset + lapDistVar.offset, true) : 0;
    const speed = speedVar ? view.getFloat32(frameOffset + speedVar.offset, true) * 3.6 : 0;
    const throttle = throttleVar ? view.getFloat32(frameOffset + throttleVar.offset, true) * 100 : 0;
    const brake = brakeVar ? view.getFloat32(frameOffset + brakeVar.offset, true) * 100 : 0;
    const steer = steerVar ? (view.getFloat32(frameOffset + steerVar.offset, true) * 180) / Math.PI : 0;
    const gear = gearVar ? view.getInt32(frameOffset + gearVar.offset, true) : 0;
    const rpm = rpmVar ? view.getFloat32(frameOffset + rpmVar.offset, true) : 0;

    lapData.lapDist.push(dist);
    lapData.speed.push(speed);
    lapData.throttle.push(throttle);
    lapData.brake.push(brake);
    lapData.steering.push(steer);
    lapData.gear.push(gear);
    lapData.rpm.push(rpm);
    lapData.time.push(sampleTimeCounter);

    sampleTimeCounter += sampleRate;
    lapData.sampleCount++;
  }

  // Filter out incomplete laps (fewer than 100 samples)
  const validLaps = Array.from(lapMap.values()).filter((l) => l.sampleCount > 100);

  return {
    fileName,
    channelsAvailable: ['Speed', 'Throttle', 'Brake', 'Steering', 'Gear', 'RPM', 'Time Delta'],
    laps: validLaps,
  };
}

// Calculate continuous time delta between reference lap and comparison lap over distance
export function calculateTimeDelta(refLap: LapData, compLap: LapData): number[] {
  const delta: number[] = [];

  for (let i = 0; i < compLap.lapDist.length; i++) {
    const dist = compLap.lapDist[i];
    const compTime = compLap.time[i];

    // Find closest matching distance sample in reference lap
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let j = 0; j < refLap.lapDist.length; j++) {
      const diff = Math.abs(refLap.lapDist[j] - dist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = j;
      }
    }

    const refTime = refLap.time[closestIdx] || 0;
    // Positive delta = comparison lap is slower (+time)
    delta.push(compTime - refTime);
  }

  return delta;
}