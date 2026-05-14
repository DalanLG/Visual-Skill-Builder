import { HashRouter, Routes, Route } from 'react-router-dom';
import Launcher from './views/Launcher';
import Environment from './views/Environment';
import SkillsStudioWindow from './views/SkillsStudioWindow';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/launcher" element={<Launcher />} />
        <Route path="/env/:environmentId/skills-studio" element={<SkillsStudioWindow />} />
        <Route path="/env/:environmentId" element={<Environment />} />
        <Route path="/" element={<Launcher />} />
      </Routes>
    </HashRouter>
  );
}
