import { createRoot } from 'react-dom/client';
import { ArchitectureSection } from './ArchitectureSection.tsx';
import { PerformanceChart } from './PerformanceChart.tsx';

const perfEl = document.getElementById('perf-root');
if (perfEl) {
  createRoot(perfEl).render(<PerformanceChart />);
}

const archEl = document.getElementById('arch-root');
if (archEl) {
  createRoot(archEl).render(<ArchitectureSection />);
}
