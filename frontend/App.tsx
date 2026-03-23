import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Assessment from './pages/Assessment'
import Training from './pages/Training'
import Incubation from './pages/Incubation'
import Experience from './pages/Experience'
import Admin from './pages/Admin'
import TestConfig from './pages/TestConfig'
import Profile from './pages/Profile'
import BasicAssessment from './pages/BasicAssessment'
import Login from './pages/Login'
import './App.css'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/assessment" element={<Assessment />} />
        <Route path="/training" element={<Training />} />
        <Route path="/incubation" element={<Incubation />} />
        <Route path="/experience" element={<Experience />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/test-config" element={<TestConfig />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/basic-assessment" element={<BasicAssessment />} />
      </Routes>
    </Router>


  )
}

export default App
