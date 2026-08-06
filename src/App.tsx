import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Tools from '@/pages/Tools'
import Favorites from '@/pages/Favorites'
import Workflows from '@/pages/Workflows'
import WorkflowDetail from '@/pages/WorkflowDetail'
import Runs from '@/pages/Runs'
import Canvases from '@/pages/Canvases'
import CanvasEditor from '@/pages/CanvasEditor'
import About from '@/pages/About'
import NotFound from '@/pages/NotFound'
import { ServerAccountProvider } from '@/lib/serverAccount'

export default function App() {
  return (
    <ServerAccountProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/workflows/:slug" element={<WorkflowDetail />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/canvas" element={<Canvases />} />
            <Route path="/canvas/:id" element={<CanvasEditor />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </ServerAccountProvider>
  )
}
