import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Tools from '@/pages/Tools'
import Favorites from '@/pages/Favorites'
import About from '@/pages/About'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
