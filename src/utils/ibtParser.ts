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
  const lapDistPctVar = findVar('LapDistPct');
  const speedVar = findVar('Speed');
  const throttleVar = findVar('Throttle');
  const brakeVar = findVar('Brake');
  const steerVar = findVar('SteeringWheelAngle');
  const gearVar = findVar('Gear');
  const rpmVar = findVar('RPM');

  const lapMap = new Map<number, LapData>();
  const sampleRate = 1 / 60; // 60 Hz iRacing telemetry

  for (let i = 0; i < bufCount; i++) {
    const frameOffset = bufOffset + i * bufLen;

    const currentLap = lapVar ? view.getInt32(frameOffset + lapVar.offset, true) : 1;
    if (currentLap < 1) continue; // Skip outlaps / pit garage samples (Lap <= 0)

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
    }

    const lapData = lapMap.get(currentLap)!;

    // Retrieve Lap Distance (m) or Lap Distance Pct * 100
    let dist = 0;
    if (lapDistVar) {
      dist = view.getFloat32(frameOffset + lapDistVar.offset, true);
    } else if (lapDistPctVar) {
      dist = view.getFloat32(frameOffset + lapDistPctVar.offset, true) * 100;
    }

    const speed = speedVar ? view.getFloat32(frameOffset + speedVar.offset, true) * 3.6 : 0;
    const throttle = throttleVar ? view.getFloat32(frameOffset + throttleVar.offset, true) * 100 : 0;
    const brake = brakeVar ? view.getFloat32(frameOffset + brakeVar.offset, true) * 100 : 0;
    const steer = steerVar ? (view.getFloat32(frameOffset + steerVar.offset, true) * 180) / Math.PI : 0;
    const gear = gearVar ? view.getInt32(frameOffset + gearVar.offset, true) : 0;
    const rpm = rpmVar ? view.getFloat32(frameOffset + rpmVar.offset, true) : 0;

    const sampleTime = lapData.sampleCount * sampleRate;

    lapData.lapDist.push(dist);
    lapData.speed.push(speed);
    lapData.throttle.push(throttle);
    lapData.brake.push(brake);
    lapData.steering.push(steer);
    lapData.gear.push(gear);
    lapData.rpm.push(rpm);
    lapData.time.push(sampleTime);

    lapData.sampleCount++;
  }

  // Filter out incomplete laps and fix X-axis ordering for uPlot
  const validLaps = Array.from(lapMap.values())
    .filter((l) => l.sampleCount > 100)
    .map((lap) => {
      // Check if distance values are monotonically increasing; if not, fallback to sample index/distance proxy
      let isMonotonic = true;
      for (let i = 1; i < lap.lapDist.length; i++) {
        if (lap.lapDist[i] < lap.lapDist[i - 1]) {
          isMonotonic = false;
          break;
        }
      }

      // If distance resets inside the lap, enforce monotonic distance array using index steps
      if (!isMonotonic || lap.lapDist[lap.lapDist.length - 1] === 0) {
        lap.lapDist = lap.lapDist.map((_, idx) => idx * 0.5); // Approx distance step
      }

      return lap;
    });

  return {
    fileName,
    channelsAvailable: ['Speed', 'Throttle', 'Brake', 'Steering', 'Gear', 'RPM', 'Time Delta'],
    laps: validLaps,
  };
}

export function calculateTimeDelta(refLap: LapData, compLap: LapData): number[] {
  const delta: number[] = [];
  const minLen = Math.min(refLap.speed.length, compLap.speed.length);

  for (let i = 0; i < compLap.lapDist.length; i++) {
    const idx = Math.min(i, minLen - 1);
    const compTime = compLap.time[i];
    const refTime = refLap.time[idx] || 0;
    delta.push(compTime - refTime);
  }

  return delta;
}