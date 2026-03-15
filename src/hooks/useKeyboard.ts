import { useEffect } from 'react'
import type { Viewer } from 'cesium'
import { useStore } from '../store'

const LOCATIONS = [
  'Global', 'Austin', 'San Francisco', 'New York', 'Tokyo',
  'London', 'Paris', 'Dubai', 'Washington DC', 'Hong Kong', 'Singapore',
]

const LAYER_KEYS: Record<string, string> = {
  '1': 'avi-civil',
  '2': 'maritime',
  '3': 'satellites',
  '4': 'seismic',
  '5': 'fires',
  '6': 'avi-mil',
  '7': 'airq',
  '8': 'weather',
  '9': 'nightlights',
}

const MODE_KEYS: Record<string, string> = {
  f: 'FLIR',
  n: 'NVG',
  c: 'CRT',
}

export function useKeyboard(viewerRef: React.RefObject<Viewer | null>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Skip when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      const key = e.key.toLowerCase()
      const { selectedCity, setCity, toggleLayer, setMode, setSelectedEntity } = useStore.getState()

      // City cycling
      if (key === 'q') {
        const idx = LOCATIONS.indexOf(selectedCity)
        const prev = idx <= 0 ? LOCATIONS.length - 1 : idx - 1
        setCity(LOCATIONS[prev])
        return
      }
      if (key === 'e') {
        const idx = LOCATIONS.indexOf(selectedCity)
        const next = (idx + 1) % LOCATIONS.length
        setCity(LOCATIONS[next])
        return
      }
      if (key === 'r') {
        setCity('Global')
        return
      }

      // Layer toggles
      if (LAYER_KEYS[key]) {
        toggleLayer(LAYER_KEYS[key])
        return
      }

      // Mode switches
      if (MODE_KEYS[key]) {
        setMode(MODE_KEYS[key])
        return
      }

      // GPS coordinate jump modal
      if (key === 'g') {
        const { gpsModalOpen, setGpsModalOpen } = useStore.getState()
        setGpsModalOpen(!gpsModalOpen)
        return
      }

      // Timeline toggle (placeholder — future 4D timeline)
      if (key === 't') {
        console.info('[Keyboard] Timeline toggle — not yet implemented')
        return
      }

      // Space — play/pause (placeholder — future timeline playback)
      if (key === ' ') {
        e.preventDefault()
        console.info('[Keyboard] Play/Pause — not yet implemented')
        return
      }

      // Camera controls (W/S pitch, A/D orbit)
      const viewer = viewerRef.current
      if (viewer && !viewer.isDestroyed()) {
        const step = 0.05
        if (key === 'w') {
          viewer.camera.rotateUp(step)
          viewer.scene.requestRender()
          return
        }
        if (key === 's') {
          viewer.camera.rotateDown(step)
          viewer.scene.requestRender()
          return
        }
        if (key === 'a') {
          viewer.camera.rotateLeft(step)
          viewer.scene.requestRender()
          return
        }
        if (key === 'd') {
          viewer.camera.rotateRight(step)
          viewer.scene.requestRender()
          return
        }
      }

      // Deselect entity + stop tracking
      if (key === 'escape') {
        const { setTrackedEntity } = useStore.getState()
        setTrackedEntity(null)
        setSelectedEntity(null)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewerRef])
}
