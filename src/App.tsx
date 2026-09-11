import React, { useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { parseIBT } from './utils/ibtParser';

export function App() {
  const chartRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      const data = parseIBT(buffer);

      if (chartRef.current) {
        chartRef.current.innerHTML = '';

        const opts: uPlot.Options = {
          title: `iRacing Telemetry - ${file.name}`,
          width: chartRef.current.clientWidth || 900,
          height: 450,
          series: [
            { label: 'Distance (m)' },
            { label: 'Speed (km/h)', stroke: '#2563eb', width: 2 },
            { label: 'Throttle (%)', stroke: '#16a34a', width: 2 },
            { label: 'Brake (%)', stroke: '#dc2626', width: 2 },
          ],
        };

        const uplotData: uPlot.AlignedData = [
          data.lapDistData,
          data.speedData,
          data.throttleData,
          data.brakeData,
        ];

        new uPlot(opts, uplotData, chartRef.current);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'system-ui, sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>RKTelemetry Viewer</h1>
      <p>Select an iRacing <code>.ibt</code> file to analyze telemetry.</p>
      <input type="file" accept=".ibt" onChange={handleFileUpload} style={{ marginBottom: '20px' }} />
      <div ref={chartRef} />
    </div>
  );
}

export default App;