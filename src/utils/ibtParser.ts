export interface IbtHeader {
  type: number;
  offset: number;
  count: number;
  name: string;
  unit: string;
}

export function parseIBT(arrayBuffer: ArrayBuffer) {
  const view = new DataView(arrayBuffer);

  const numVars = view.getInt32(12, true);
  const varHeaderOffset = view.getInt32(16, true);
  const bufCount = view.getInt32(20, true);
  const bufLen = view.getInt32(24, true);
  const bufOffset = view.getInt32(52, true);

  const vars: IbtHeader[] = [];

  for (let i = 0; i < numVars; i++) {
    const offset = varHeaderOffset + i * 144;
    const type = view.getInt32(offset, true);
    const varOffset = view.getInt32(offset + 4, true);
    const count = view.getInt32(offset + 8, true);

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

    vars.push({ type, offset: varOffset, count, name, unit });
  }

  const speedVar = vars.find((v) => v.name === 'Speed');
  const throttleVar = vars.find((v) => v.name === 'Throttle');
  const brakeVar = vars.find((v) => v.name === 'Brake');
  const lapDistVar = vars.find((v) => v.name === 'LapDist');

  const lapDistData: number[] = [];
  const speedData: number[] = [];
  const throttleData: number[] = [];
  const brakeData: number[] = [];

  for (let i = 0; i < bufCount; i++) {
    const frameOffset = bufOffset + i * bufLen;

    if (lapDistVar) lapDistData.push(view.getFloat32(frameOffset + lapDistVar.offset, true));
    if (speedVar) speedData.push(view.getFloat32(frameOffset + speedVar.offset, true) * 3.6); // m/s to km/h
    if (throttleVar) throttleData.push(view.getFloat32(frameOffset + throttleVar.offset, true) * 100); // %
    if (brakeVar) brakeData.push(view.getFloat32(frameOffset + brakeVar.offset, true) * 100); // %
  }

  return { lapDistData, speedData, throttleData, brakeData };
}