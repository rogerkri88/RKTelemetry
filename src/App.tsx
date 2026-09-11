import React, { useRef, useState, useEffect } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { parseIBT, ParsedIBT, calculateTimeDelta } from './utils/ibtParser';

export function App() {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotInstance = useRef<uPlot | null>(null);

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

    const refLap = session1.laps.find((l) => l.lapNum === refLapNum) || session1.laps[0];
    const compSession = session2 || session1;
    const compLap = compSession.laps.find((l) => l.lapNum === compLapNum) || compSession.laps[0];

    if (!refLap || !compLap) return;

    const timeDeltaData = calculateTimeDelta(refLap, compLap);

    const seriesConfig: uPlot.Series[] = [{ label: 'Distance (m)' }];
    const dataArrays: number[][] = [compLap.lapDist];

    if (activeChannels['Speed']) {
      seriesConfig.push({ label: 'Ref Speed (km/h)', stroke: '#2563eb', width: 2 });
      dataArrays.push(refLap.speed);
      seriesConfig.push({ label: 'Comp Speed (km/h)', stroke: '#60a5fa', width: 2, dash: [5, 5] });
      dataArrays.push(compLap.speed);
    }

    if (activeChannels['Throttle']) {
      seriesConfig.push({ label: 'Ref Throttle (%)', stroke: '#16a34a', width: 2 });
      dataArrays.push(refLap.throttle);
      seriesConfig.push({ label: 'Comp Throttle (%)', stroke: '#4ade80', width: 2, dash: [5, 5] });
      dataArrays.push(compLap.throttle);
    }

    if (activeChannels['Brake']) {
      seriesConfig.push({ label: 'Ref Brake (%)', stroke: '#dc2626', width: 2 });
      dataArrays.push(refLap.brake);
      seriesConfig.push({ label: 'Comp Brake (%)', stroke: '#f87171', width: 2, dash: [5, 5] });
      dataArrays.push(compLap.brake);
    }

    if (activeChannels['Steering']) {
      seriesConfig.push({ label: 'Ref Steering (°)', stroke: '#8b5cf6', width: 1.5 });
      dataArrays.push(refLap.steering);
      seriesConfig.push({ label: 'Comp Steering (°)', stroke: '#c084fc', width: 1.5, dash: [5, 5] });
      dataArrays.push(compLap.steering);
    }

    if (activeChannels['Gear']) {
      seriesConfig.push({ label: 'Ref Gear', stroke: '#d97706', width: 1.5 });
      dataArrays.push(refLap.gear);
      seriesConfig.push({ label: 'Comp Gear', stroke: '#fbbf24', width: 1.5, dash: [5, 5] });
      dataArrays.push(compLap.gear);
    }

    if (activeChannels['RPM']) {
      seriesConfig.push({ label: 'Ref RPM', stroke: '#0891b2', width: 1.5 });
      dataArrays.push(refLap.rpm);
      seriesConfig.push({ label: 'Comp RPM', stroke: '#22d3ee', width: 1.5, dash: [5, 5] });
      dataArrays.push(compLap.rpm);
    }

    if (activeChannels['Time Delta']) {
      seriesConfig.push({ label: 'Time Delta (s)', stroke: '#e11d48', width: 2 });
      dataArrays.push(timeDeltaData);
    }

    chartRef.current.innerHTML = '';

    const opts: uPlot.Options = {
      title: `Telemetry Overlay: ${session1.fileName} (Lap ${refLap.lapNum}) vs ${compSession.fileName} (Lap ${compLap.lapNum})`,
      width: chartRef.current.clientWidth || 950,
      height: 500,
      series: seriesConfig,
      scales: {
        x: { time: false },
      },
    };

    uplotInstance.current = new uPlot(opts, dataArrays as uPlot.AlignedData, chartRef.current);
  }, [session1, session2, refLapNum, compLapNum, activeChannels]);

  return (
    <div style={{ padding: '25px', fontFamily: 'system-ui, sans-serif', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>RKTelemetry Advanced Viewer</h1>

      {/* File Upload Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h3>Base Lap / File 1</h3>
          <input type="file" accept=".ibt" onChange={(e) => handleFileUpload(e, 1)} />
          {session1 && (
            <div style={{ marginTop: '10px' }}>
              <label>Select Lap: </label>
              <select value={refLapNum} onChange={(e) => setRefLapNum(Number(e.target.value))}>
                {session1.laps.map((l) => (
                  <option key={l.lapNum} value={l.lapNum}>
                    Lap {l.lapNum} ({l.sampleCount} samples)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h3>Comparison Lap / File 2 (Optional)</h3>
          <input type="file" accept=".ibt" onChange={(e) => handleFileUpload(e, 2)} />
          {session1 && (
            <div style={{ marginTop: '10px' }}>
              <label>Select Lap: </label>
              <select value={compLapNum} onChange={(e) => setCompLapNum(Number(e.target.value))}>
                {(session2 || session1).laps.map((l) => (
                  <option key={l.lapNum} value={l.lapNum}>
                    Lap {l.lapNum} ({l.sampleCount} samples)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Channel Toggles */}
      {session1 && (
        <div style={{ marginBottom: '20px', padding: '10px', background: '#f4f4f5', borderRadius: '6px' }}>
          <strong>Toggle Channels: </strong>
          {Object.keys(activeChannels).map((ch) => (
            <label key={ch} style={{ marginRight: '15px', cursor: 'pointer' }}>
              <input type="checkbox" checked={activeChannels[ch]} onChange={() => toggleChannel(ch)} /> {ch}
            </label>
          ))}
        </div>
      )}

      {/* Chart Canvas Container */}
      <div ref={chartRef} />
    </div>
  );
}

export default App;