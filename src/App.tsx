import { HashRouter, Routes, Route } from 'react-router-dom';
import Launcher from './views/Launcher';
import Environment from './views/Environment';
import SkillsStudioWindow from './views/SkillsStudioWindow';
import SetupWizard from './views/SetupWizard';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/launcher" element={<Launcher />} />
        <Route path="/env/:environmentId/skills-studio" element={<SkillsStudioWindow />} />
        <Route path="/env/:environmentId" element={<Environment />} />
        <Route path="/" element={<SetupWizard />} />
      </Routes>
    </HashRouter>
  );
}
