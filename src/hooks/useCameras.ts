import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { fetchCameras, type CameraFeed, type CameraMeta, type CameraCountry } from '../adapters/cctv'

const POLL_INTERVAL = 5 * 60_000 // 5 min
const BACKOFF_BASE = 30_000
const BACKOFF_CAP = 120_000

interface UseCamerasOptions {
  enabled: boolean
  countryFilter?: string
}

export function useCameras({ enabled, countryFilter }: UseCamerasOptions) {
  const [cameras, setCameras] = useState<CameraFeed[]>([])
  const [meta, setMeta] = useState<CameraMeta | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const consecutiveErrors = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cacheRef = useRef<CameraFeed[]>([])

  const doFetch = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await fetchCameras(countryFilter)
      setCameras(result.cameras)
      setMeta(result.meta)
      cacheRef.current = result.cameras
      setError(null)
      consecutiveErrors.current = 0
      return POLL_INTERVAL
    } catch (e: any) {
      console.warn('[useCameras] Fetch error:', e.message)
      setError(e.message)
      consecutiveErrors.current++
      // Exponential backoff: 30s → 60s → 120s cap
      return Math.min(BACKOFF_BASE * Math.pow(2, consecutiveErrors.current - 1), BACKOFF_CAP)
    } finally {
      setIsLoading(false)
    }
  }, [countryFilter])

  const refetch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    doFetch().then(nextDelay => {
      timerRef.current = setTimeout(function poll() {
        doFetch().then(d => { timerRef.current = setTimeout(poll, d) })
      }, nextDelay)
    })
  }, [doFetch])

  useEffect(() => {
    if (!enabled) {
      setCameras([])
      setMeta(null)
      setError(null)
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    // Instant restore from cache
    if (cacheRef.current.length > 0) setCameras(cacheRef.current)

    // Initial fetch + poll loop
    doFetch().then(nextDelay => {
      timerRef.current = setTimeout(function poll() {
        doFetch().then(d => { timerRef.current = setTimeout(poll, d) })
      }, nextDelay)
    })

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, doFetch])

  const totalOnline = meta?.onlineCameras ?? 0
  const totalCameras = meta?.totalCameras ?? 0

  const availableCountries = useMemo<CameraCountry[]>(() => {
    return meta?.countries ?? []
  }, [meta])

  return { cameras, isLoading, error, totalOnline, totalCameras, availableCountries, refetch }
}
