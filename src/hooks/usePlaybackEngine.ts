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
  // Track our own last write so we can detect external changes (scrubber seeks)
  const lastWrittenTime = useRef(0)

  const tick = useCallback((dt: number) => {
    const state = useStore.getState()

    if (!state.playbackMode) {
      playbackTimeRef.current = Date.now()
      lastWrittenTime.current = 0
      return
    }

    const storeTime = state.playbackTime

    // Detect external seek: if store's playbackTime differs from what WE last wrote,
    // someone else (scrubber) changed it — snap the ref immediately.
    if (lastWrittenTime.current > 0 && storeTime !== lastWrittenTime.current) {
      playbackTimeRef.current = storeTime
      lastWrittenTime.current = storeTime
    }

    // On first entry to playback mode, sync ref to store
    if (lastWrittenTime.current === 0) {
      playbackTimeRef.current = storeTime
      lastWrittenTime.current = storeTime
    }

    if (!state.playbackPlaying) {
      // When paused, always follow store (user may be scrubbing)
      playbackTimeRef.current = storeTime
      lastWrittenTime.current = storeTime
      return
    }

    // Advance virtual time
    playbackTimeRef.current += dt * state.playbackSpeed

    // Clamp to range
    const [start, end] = state.playbackRange
    if (playbackTimeRef.current >= end) {
      playbackTimeRef.current = end
      useStore.setState({ playbackPlaying: false, playbackTime: end })
      lastWrittenTime.current = end
      return
    }
    if (playbackTimeRef.current < start) {
      playbackTimeRef.current = start
    }

    // Throttle Zustand writes to ~5fps to avoid flooding React renders
    const now = performance.now()
    if (now - lastStoreWrite.current > 200) {
      lastStoreWrite.current = now
      const t = playbackTimeRef.current
      useStore.setState({ playbackTime: t })
      lastWrittenTime.current = t
    }
  }, [])

  return { playbackTimeRef, tick }
}
