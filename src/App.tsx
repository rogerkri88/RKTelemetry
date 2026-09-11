import React, { useRef, useState, useEffect } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { parseIBT, calculateTimeDelta, type ParsedIBT, type LapData } from './utils/ibtParser';

function resampleArray(sourceDist: number[], sourceData: number[], targetDist: number[]): number[] {
  if (!sourceDist.length || !sourceData.length) return targetDist.map(() => 0);

  return targetDist.map((td) => {
    if (td <= sourceDist[0]) return sourceData[0];
    if (td >= sourceDist[sourceDist.length - 1]) return sourceData[sourceData.length - 1];

    let low = 0;
    let high = sourceDist.length - 1;

    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (sourceDist[mid] > td) high = mid;
      else low = mid;
    }

    const t0 = sourceDist[low];
    const t1 = sourceDist[high];
    const v0 = sourceData[low];
    const v1 = sourceData[high];

    if (t1 === t0) return v0;
    return v0 + ((td - t0) / (t1 - t0)) * (v1 - v0);
  });
}

export function App() {
  const chartRef = useRef<HTMLDivElement>(null);

  const [session1, setSession1] = useState<ParsedIBT | null>(null);
  const [session2, setSession2] = useState<ParsedIBT | null>(null);

  const [refLapNum, setRefLapNum] = useState<number>(1);
  const [compLapNum, setCompLapNum] = useState<number>(1);

  const [activeChannels, setActiveChannels] = useState<{ [key: string]: boolean }>({
    Speed: true,
    Throttle: true,
    Brake: true,
    Steering: false,
    Gear: false,
    RPM: false,
    'Time Delta': true,
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, slot: 1 | 2) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      const parsed = parseIBT(buffer, file.name);

      if (slot === 1) {
        setSession1(parsed);
        if (parsed.laps.length > 0) setRefLapNum(parsed.laps[0].lapNum);
      } else {
        setSession2(parsed);
        if (parsed.laps.length > 0) setCompLapNum(parsed.laps[0].lapNum);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleChannel = (channel: string) => {
    setActiveChannels((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  useEffect(() => {
    if (!session1 || !chartRef.current) return;

    const refLap: LapData = session1.laps.find((l) => l.lapNum === refLapNum) || session1.laps[0];
    const compSession = session2 || session1;
    const compLap: LapData = compSession.laps.find((l) => l.lapNum === compLapNum) || compSession.laps[0];

    if (!refLap || !compLap) return;

    const baseDist = refLap.lapDist;
    const compSpeedResampled = resampleArray(compLap.lapDist, compLap.speed, baseDist);
    const compThrottleResampled = resampleArray(compLap.lapDist, compLap.throttle, baseDist);
    const compBrakeResampled = resampleArray(compLap.lapDist, compLap.brake, baseDist);
    const compSteerResampled = resampleArray(compLap.lapDist, compLap.steering, baseDist);
    const compGearResampled = resampleArray(compLap.lapDist, compLap.gear, baseDist);
    const compRpmResampled = resampleArray(compLap.lapDist, compLap.rpm, baseDist);

    const rawDelta = calculateTimeDelta(refLap, compLap);
    const timeDeltaData = resampleArray(compLap.lapDist, rawDelta, baseDist);

    const seriesConfig: uPlot.Series[] = [{ label: 'Distance (m)' }];
    const dataArrays: number[][] = [baseDist];

    if (activeChannels['Speed']) {
      seriesConfig.push({ label: 'Ref Speed (km/h)', stroke: '#2563eb', width: 2 });
      dataArrays.push(refLap.speed);
      seriesConfig.push({ label: 'Comp Speed (km/h)', stroke: '#60a5fa', width: 2, dash: [5, 5] });
      dataArrays.push(compSpeedResampled);
    }

    if (activeChannels['Throttle']) {
      seriesConfig.push({ label: 'Ref Throttle (%)', stroke: '#16a34a', width: 2 });
      dataArrays.push(refLap.throttle);
      seriesConfig.push({ label: 'Comp Throttle (%)', stroke: '#4ade80', width: 2, dash: [5, 5] });
      dataArrays.push(compThrottleResampled);
    }

    if (activeChannels['Brake']) {
      seriesConfig.push({ label: 'Ref Brake (%)', stroke: '#dc2626', width: 2 });
      dataArrays.push(refLap.brake);
      seriesConfig.push({ label: 'Comp Brake (%)', stroke: '#f87171', width: 2, dash: [5, 5] });
      dataArrays.push(compBrakeResampled);
    }

    if (activeChannels['Steering']) {
      seriesConfig.push({ label: 'Ref Steering (°)', stroke: '#8b5cf6', width: 1.5 });
      dataArrays.push(refLap.steering);
      seriesConfig.push({ label: 'Comp Steering (°)', stroke: '#c084fc', width: 1.5, dash: [5, 5] });
      dataArrays.push(compSteerResampled);
    }

    if (activeChannels['Gear']) {
      seriesConfig.push({ label: 'Ref Gear', stroke: '#d97706', width: 1.5 });
      dataArrays.push(refLap.gear);
      seriesConfig.push({ label: 'Comp Gear', stroke: '#fbbf24', width: 1.5, dash: [5, 5] });
      dataArrays.push(compGearResampled);
    }

    if (activeChannels['RPM']) {
      seriesConfig.push({ label: 'Ref RPM', stroke: '#0891b2', width: 1.5 });
      dataArrays.push(refLap.rpm);
      seriesConfig.push({ label: 'Comp RPM', stroke: '#22d3ee', width: 1.5, dash: [5, 5] });
      dataArrays.push(compRpmResampled);
    }

    if (activeChannels['Time Delta']) {
      seriesConfig.push({ label: 'Time Delta (s)', stroke: '#e11d48', width: 2 });
      dataArrays.push(timeDeltaData);
    }

    chartRef.current.innerHTML = '';

    const opts: uPlot.Options = {
      title: `Telemetry Overlay: Lap ${refLap.lapNum} vs Lap ${compLap.lapNum}`,
      width: chartRef.current.clientWidth || 950,
      height: 500,
      series: seriesConfig,
      scales: {
        x: { time: false },
      },
    };

    new uPlot(opts, dataArrays as uPlot.AlignedData, chartRef.current);
  }, [session1, session2, refLapNum, compLapNum, activeChannels]);

  return (
    <div style={{ padding: '25px', fontFamily: 'system-ui, sans-serif', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>RKTelemetry Advanced Viewer</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ padding: '15px', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Base Lap / File 1</h3>
          <input type="file" accept=".ibt" onChange={(e) => handleFileUpload(e, 1)} />
          {session1 && (
            <div style={{ marginTop: '10px' }}>
              <label>Select Lap: </label>
              <select value={refLapNum} onChange={(e) => setRefLapNum(Number(e.target.value))}>
                {session1.laps.map((l) => (
                  <option key={l.lapNum} value={l.lapNum}>
                    Lap {l.lapNum} ({(l.time[l.time.length - 1] || 0).toFixed(2)}s - {l.sampleCount} pts)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ padding: '15px', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Comparison Lap / File 2 (Optional)</h3>
          <input type="file" accept=".ibt" onChange={(e) => handleFileUpload(e, 2)} />
          {(session2 || session1) && (
            <div style={{ marginTop: '10px' }}>
              <label>Select Lap: </label>
              <select value={compLapNum} onChange={(e) => setCompLapNum(Number(e.target.value))}>
                {(session2 || session1)!.laps.map((l) => (
                  <option key={l.lapNum} value={l.lapNum}>
                    Lap {l.lapNum} ({(l.time[l.time.length - 1] || 0).toFixed(2)}s - {l.sampleCount} pts)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {session1 && (
        <div style={{ marginBottom: '20px', padding: '10px', background: '#222', borderRadius: '6px' }}>
          <strong>Toggle Channels: </strong>
          {Object.keys(activeChannels).map((ch) => (
            <label key={ch} style={{ marginRight: '15px', cursor: 'pointer' }}>
              <input type="checkbox" checked={activeChannels[ch]} onChange={() => toggleChannel(ch)} /> {ch}
            </label>
          ))}
        </div>
      )}

      <div ref={chartRef} />
    </div>
  );
}

export default App;