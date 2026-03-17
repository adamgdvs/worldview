import { useRef, useCallback } from 'react'
import { useStore } from '../store'

/**
 * Playback engine: advances virtual time each rAF frame.
 * Returns a ref holding the current playback time and a tick() function
 * to call from the animation loop.
 */
export function usePlaybackEngine() {
  const playbackTimeRef = useRef(Date.now())
  const lastStoreWrite = useRef(0)

  const tick = useCallback((dt: number) => {
    const state = useStore.getState()

    if (!state.playbackMode) {
      playbackTimeRef.current = Date.now()
      return
    }

    if (!state.playbackPlaying) {
      // Keep ref synced with store when paused (user may have seeked)
      playbackTimeRef.current = state.playbackTime
      return
    }

    // Advance virtual time
    playbackTimeRef.current += dt * state.playbackSpeed

    // Clamp to range
    const [start, end] = state.playbackRange
    if (playbackTimeRef.current >= end) {
      playbackTimeRef.current = end
      // Auto-pause at end
      useStore.setState({ playbackPlaying: false, playbackTime: end })
      return
    }
    if (playbackTimeRef.current < start) {
      playbackTimeRef.current = start
    }

    // Throttle Zustand writes to ~5fps to avoid flooding React renders
    const now = performance.now()
    if (now - lastStoreWrite.current > 200) {
      lastStoreWrite.current = now
      useStore.setState({ playbackTime: playbackTimeRef.current })
    }
  }, [])

  return { playbackTimeRef, tick }
}
