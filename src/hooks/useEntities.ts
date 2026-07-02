import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { fetchFlights, fetchFlightsAtTime, fetchMilitaryFlights, getOpenSkyStatus, isMilitaryFlight, type FlightState } from '../adapters/aviation'
import { AISAdapter, type VesselState } from '../adapters/maritime'
import { fetchSeismicEvents, type SeismicEvent } from '../adapters/seismic'
import { fetchWildfires, type WildfireHotspot } from '../adapters/wildfire'
import { fetchSatellites, propagateAll, propagateAllAtTime, type SatelliteState } from '../adapters/satellites'
import { fetchAirQuality, type AQStation } from '../adapters/airquality'
import { fetchGpsJamData, type GpsJamCell } from '../adapters/gpsjam'
import { fetchRoadNetworkByBbox, type RoadSegment } from '../adapters/traffic'
import { useStore } from '../store'

export function useEntities(playbackTimeRef?: MutableRefObject<number>) {
  const [flights, setFlights] = useState<Map<string, FlightState>>(new Map())
  const [militaryFlights, setMilitaryFlights] = useState<Map<string, FlightState>>(new Map())
  const [vessels, setVessels] = useState<Map<number, VesselState>>(new Map())
  const [seismicEvents, setSeismicEvents] = useState<SeismicEvent[]>([])
  const [wildfires, setWildfires] = useState<WildfireHotspot[]>([])
  const [sats, setSats] = useState<SatelliteState[]>([])
  const [airQuality, setAirQuality] = useState<AQStation[]>([])
  const [gpsJam, setGpsJam] = useState<GpsJamCell[]>([])
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([])
  const { activeLayers } = useStore()
  const playbackMode = useStore((s) => s.playbackMode)
  const aisAdapterRef = useRef<AISAdapter | null>(null)

  // ── Data caches: persist across toggle cycles for instant restore ────────
  const civilCache = useRef<Map<string, FlightState>>(new Map())
  const milCache   = useRef<Map<string, FlightState>>(new Map())
  const seismicCache = useRef<SeismicEvent[]>([])
  const fireCache    = useRef<WildfireHotspot[]>([])
  const satCache     = useRef<SatelliteState[]>([])
  const aqCache      = useRef<AQStation[]>([])
  const gpsJamCache  = useRef<GpsJamCell[]>([])

  const { setLayerLoading, setLayerError } = useStore.getState()

  // Derive individual booleans so each effect only re-runs when its own layer toggles
  const wantCivil    = activeLayers.includes('avi-civil')
  const wantMil      = activeLayers.includes('avi-mil')
  const wantMaritime = activeLayers.includes('maritime')
  const wantSeismic  = activeLayers.includes('seismic')
  const wantFires    = activeLayers.includes('fires')
  const wantSats     = activeLayers.includes('satellites')
  const wantAirQ     = activeLayers.includes('airq')
  const wantGpsJam   = activeLayers.includes('gpsjam')
  const wantTraffic  = activeLayers.includes('traffic')

  // ── Aviation (civil + military) ──────────────────────────────────────────
  useEffect(() => {
    if (!wantCivil && !wantMil) {
      setFlights(new Map())
      setMilitaryFlights(new Map())
      setLayerError('avi-civil', null)
      setLayerError('avi-mil', null)
      return
    }

    // Show loading if cache is empty (first fetch)
    if (wantCivil && civilCache.current.size === 0) setLayerLoading('avi-civil', true)
    if (wantMil && milCache.current.size === 0) setLayerLoading('avi-mil', true)

    if (playbackMode) {
      // Historical playback: fetch a single snapshot, then dead-reckon positions
      // based on playback time so scrubbing + play both animate correctly.
      let cancelled = false
      let snapshot: FlightState[] = []
      let snapshotTimeMs = 0  // sim-time (ms) the snapshot represents
      let lastComputedTime = 0  // avoid redundant re-computation at same time

      const DEG_TO_RAD = Math.PI / 180

      // Compute dead-reckoned positions from snapshot at given sim-time
      const computePositions = (simTimeMs: number) => {
        if (snapshot.length === 0) return
        // Skip if already computed at this time (within 50ms tolerance)
        if (Math.abs(simTimeMs - lastComputedTime) < 50) return
        lastComputedTime = simTimeMs

        const elapsedSec = (simTimeMs - snapshotTimeMs) / 1000
        const civil = new Map<string, FlightState>()
        const mil   = new Map<string, FlightState>()

        for (const f of snapshot) {
          if (f.latitude == null || f.longitude == null || f.on_ground) continue
          const vel = f.velocity ?? 0
          const hdg = (f.true_track ?? 0) * DEG_TO_RAD
          // Dead-reckon lat/lon from snapshot position
          const dLat = vel > 0 ? Math.cos(hdg) * vel * elapsedSec / 111_320 : 0
          const cosLat = Math.cos((f.latitude!) * DEG_TO_RAD)
          const dLon = vel > 0 && cosLat > 0.01
            ? Math.sin(hdg) * vel * elapsedSec / (111_320 * cosLat)
            : 0
          const moved: FlightState = {
            ...f,
            latitude: f.latitude! + dLat,
            longitude: f.longitude! + dLon,
          }
          if (isMilitaryFlight(f)) mil.set(f.icao24, moved)
          else civil.set(f.icao24, moved)
        }

        civilCache.current = civil
        milCache.current = mil
        if (wantCivil) setFlights(civil)
        else setFlights(new Map())
        if (wantMil) setMilitaryFlights(mil)
        else setMilitaryFlights(new Map())
      }

      // Fetch snapshot once
      const initTime = useStore.getState().playbackRange[0]
      ;(async () => {
        let data = await fetchFlightsAtTime(initTime / 1000)
        if (data.length === 0) {
          // Historical unavailable — fall back to live snapshot
          const bbox = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
          data = await fetchFlights(bbox)
        }
        if (cancelled || !useStore.getState().playbackMode) return
        snapshot = data
        snapshotTimeMs = initTime
        setLayerLoading('avi-civil', false)
        setLayerLoading('avi-mil', false)
        // Compute initial positions at the playback start
        computePositions(initTime)
      })()

      // Fast position update loop (100ms) — reads playbackTimeRef directly
      // so scrubbing and playing both instantly move planes.
      // When paused and not scrubbing, the dedup check (lastComputedTime) skips work.
      const interval = setInterval(() => {
        if (cancelled || !useStore.getState().playbackMode || snapshot.length === 0) return
        const simTime = playbackTimeRef?.current ?? useStore.getState().playbackTime
        computePositions(simTime)
      }, 100)

      return () => { cancelled = true; clearInterval(interval) }
    }

    // Instant restore from cache
    if (wantCivil && civilCache.current.size > 0) setFlights(civilCache.current)
    if (wantMil && milCache.current.size > 0) setMilitaryFlights(milCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      try {
        // Zoomed in → query only the viewport region. Costs far fewer OpenSky
        // rate-limit credits than global and lets the adsb.fi point-query
        // fallback engage when OpenSky is rate-limited.
        const st = useStore.getState()
        const regional = st.cameraBbox && st.cameraHeight < 4_000_000
        const bbox = regional
          ? {
              minLat: Math.max(st.cameraBbox![0] - 1, -90),
              minLon: Math.max(st.cameraBbox![1] - 1, -180),
              maxLat: Math.min(st.cameraBbox![2] + 1, 90),
              maxLon: Math.min(st.cameraBbox![3] + 1, 180),
            }
          : { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
        // Military gets a dedicated global feed (adsb.fi /v2/mil); civil keeps OpenSky.
        const [allFlights, milFeed] = await Promise.all([
          wantCivil || wantMil ? fetchFlights(bbox) : Promise.resolve([] as FlightState[]),
          wantMil ? fetchMilitaryFlights() : Promise.resolve([] as FlightState[]),
        ])
        if (!allFlights.length && !milFeed.length) {
          const osStatus = getOpenSkyStatus()
          const msg = osStatus === 'invalid-credentials'
            ? 'OpenSky credentials rejected — regenerate API client at opensky-network.org; using fallback feeds'
            : 'All flight sources rate-limited — retrying'
          if (civilCache.current.size === 0) setLayerError('avi-civil', msg)
          setLayerLoading('avi-civil', false)
          setLayerLoading('avi-mil', false)
          return
        }

        setLayerError('avi-civil', null)
        setLayerError('avi-mil', null)

        const now = Date.now() / 1000
        // Regional polls only cover the viewport — keep previously seen flights
        // so zooming in doesn't wipe the rest of the world off the globe
        const civil = regional ? new Map(civilCache.current) : new Map<string, FlightState>()
        const mil   = regional ? new Map(milCache.current) : new Map<string, FlightState>()

        const isValid = (f: FlightState) =>
          f.latitude !== null && f.longitude !== null &&
          f.latitude >= -90 && f.latitude <= 90 &&
          f.longitude >= -180 && f.longitude <= 180 &&
          !f.on_ground && now - f.last_contact < 300

        for (const f of allFlights) {
          if (!isValid(f)) continue
          if (isMilitaryFlight(f)) {
            mil.set(f.icao24, f)
          } else {
            civil.set(f.icao24, f)
          }
        }

        // Merge dedicated military feed (authoritative — wins over heuristic split)
        for (const f of milFeed) {
          if (!isValid(f)) continue
          civil.delete(f.icao24)
          mil.set(f.icao24, f)
        }

        // Update cache
        civilCache.current = civil
        milCache.current = mil

        if (wantCivil) setFlights(civil)
        else setFlights(new Map())

        if (wantMil) setMilitaryFlights(mil)
        else setMilitaryFlights(new Map())
      } catch (err) {
        console.error('[Aviation] Fetch failed:', err)
        setLayerError('avi-civil', 'Fetch failed')
        setLayerError('avi-mil', 'Fetch failed')
      } finally {
        setLayerLoading('avi-civil', false)
        setLayerLoading('avi-mil', false)
      }
    }

    poll()
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [wantCivil, wantMil, playbackMode])

  // ── Maritime WebSocket ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!wantMaritime || playbackMode) {
      if (playbackMode) return // freeze at current data — no historical API
      aisAdapterRef.current?.disconnect()
      aisAdapterRef.current = null
      setVessels(new Map())
      setLayerError('maritime', null)
      return
    }

    const apiKey = import.meta.env.VITE_AISSTREAM_API_KEY
    if (!apiKey || apiKey.includes('your_')) {
      console.warn('[Maritime] No valid API key found')
      setLayerError('maritime', 'No API key configured')
      return
    }

    setLayerLoading('maritime', true)
    setLayerError('maritime', null)
    if (!aisAdapterRef.current) {
      aisAdapterRef.current = new AISAdapter(apiKey, (vessel) => {
        setLayerLoading('maritime', false)
        setVessels(prev => {
          const next = new Map(prev)
          next.set(vessel.mmsi, vessel)
          if (next.size > 5000) {
            const now = Date.now()
            for (const [id, v] of next) {
              if (now - v.lastUpdate > 1_800_000) next.delete(id)
            }
          }
          return next
        })
      }, (error) => setLayerError('maritime', error))
      aisAdapterRef.current.connect()
    }
  }, [wantMaritime, playbackMode])

  // Helper: one-time fetch for playback mode if cache is empty
  const playbackFetchOnce = <T,>(
    want: boolean,
    cache: React.MutableRefObject<T[]>,
    setter: (v: T[]) => void,
    fetcher: () => Promise<T[]>,
    layerId?: string,
  ) => {
    if (!want) { setter([]); return }
    if (cache.current.length > 0) {
      setter(cache.current)
    } else {
      if (layerId) setLayerLoading(layerId, true)
      fetcher().then((data) => {
        if (data.length) {
          cache.current = data
          setter(data)
          if (layerId) setLayerError(layerId, null)
        } else if (layerId) {
          setLayerError(layerId, 'No data received')
        }
        if (layerId) setLayerLoading(layerId, false)
      }).catch((err) => {
        console.error(`[${layerId}] Playback fetch failed:`, err)
        if (layerId) {
          setLayerError(layerId, 'Fetch failed')
          setLayerLoading(layerId, false)
        }
      })
    }
  }

  // ── Seismic (USGS) — refresh every 5 minutes ───────────────────────────────
  useEffect(() => {
    if (!wantSeismic) {
      setSeismicEvents([])
      setLayerError('seismic', null)
      return
    }

    if (playbackMode) {
      const range = useStore.getState().playbackRange
      playbackFetchOnce(wantSeismic, seismicCache, setSeismicEvents, () => fetchSeismicEvents(2.5, 200, {
        startTime: new Date(range[0]).toISOString(),
        endTime: new Date(range[1]).toISOString(),
      }), 'seismic')
      return
    }

    // Instant restore from cache
    if (seismicCache.current.length > 0) setSeismicEvents(seismicCache.current)
    else setLayerLoading('seismic', true)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      try {
        const events = await fetchSeismicEvents(2.5, 200)
        if (events.length) {
          seismicCache.current = events
          setSeismicEvents(events)
          setLayerError('seismic', null)
        } else if (seismicCache.current.length === 0) {
          setLayerError('seismic', 'No data received')
        }
      } catch (err) {
        console.error('[Seismic] Fetch failed:', err)
        setLayerError('seismic', 'Fetch failed')
      } finally {
        setLayerLoading('seismic', false)
      }
    }

    poll()
    const interval = setInterval(poll, 5 * 60_000)
    return () => clearInterval(interval)
  }, [wantSeismic, playbackMode])

  // ── Wildfire (NASA FIRMS) — refresh every 15 minutes ─────────────────────
  useEffect(() => {
    if (!wantFires) {
      setWildfires([])
      setLayerError('fires', null)
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantFires, fireCache, setWildfires, fetchWildfires, 'fires')
      return
    }

    // Instant restore from cache
    if (fireCache.current.length > 0) setWildfires(fireCache.current)
    else setLayerLoading('fires', true)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      try {
        const hotspots = await fetchWildfires()
        if (hotspots.length) {
          fireCache.current = hotspots
          setWildfires(hotspots)
          setLayerError('fires', null)
        } else if (fireCache.current.length === 0) {
          setLayerError('fires', 'No data received')
        }
      } catch (err) {
        console.error('[Fires] Fetch failed:', err)
        setLayerError('fires', 'Fetch failed')
      } finally {
        setLayerLoading('fires', false)
      }
    }

    poll()
    const interval = setInterval(poll, 15 * 60_000)
    return () => clearInterval(interval)
  }, [wantFires, playbackMode])

  // ── Satellites — fetch TLEs once, propagate positions every 3s ────────────
  useEffect(() => {
    if (!wantSats) {
      setSats([])
      setLayerError('satellites', null)
      return
    }

    let cancelled = false

    // Instant restore from cache
    if (satCache.current.length > 0) setSats(satCache.current)
    else setLayerLoading('satellites', true)

    // Initial TLE fetch (slow, runs once) — needed for both live and playback
    const init = async () => {
      try {
        const states = await fetchSatellites()
        if (cancelled) return
        if (states.length) {
          satCache.current = states
          setSats(states)
          setLayerError('satellites', null)
        } else if (satCache.current.length === 0) {
          setLayerError('satellites', 'No data received')
        }
      } catch (err) {
        console.error('[Satellites] Fetch failed:', err)
        if (!cancelled) setLayerError('satellites', 'Fetch failed')
      } finally {
        if (!cancelled) setLayerLoading('satellites', false)
      }
    }
    init()

    // Fast propagation timer — re-compute positions from stored TLEs
    // In playback: every 500ms for responsive scrubbing. In live: every 3s.
    let lastPropTime = 0
    const propRate = playbackMode ? 500 : 3_000
    const propInterval = setInterval(() => {
      if (cancelled) return
      const isPlayback = useStore.getState().playbackMode
      const propDate = (isPlayback && playbackTimeRef?.current)
        ? new Date(playbackTimeRef.current)
        : new Date()
      // Skip if playback time hasn't changed (paused + not scrubbing)
      const propMs = propDate.getTime()
      if (isPlayback && Math.abs(propMs - lastPropTime) < 50) return
      lastPropTime = propMs
      const states = isPlayback
        ? propagateAllAtTime(propDate)
        : propagateAll(useStore.getState().showSatOrbits)
      if (states.length) {
        satCache.current = states
        setSats(states)
      }
    }, propRate)

    // Re-fetch TLEs every 10 minutes (skip in playback mode)
    const fetchInterval = setInterval(async () => {
      if (cancelled || useStore.getState().playbackMode) return
      try {
        const states = await fetchSatellites()
        if (cancelled) return
        if (states.length) {
          satCache.current = states
          setSats(states)
          setLayerError('satellites', null)
        }
      } catch (err) {
        console.error('[Satellites] Re-fetch failed:', err)
        if (!cancelled) setLayerError('satellites', 'Re-fetch failed')
      }
    }, 10 * 60_000)

    return () => {
      cancelled = true
      clearInterval(propInterval)
      clearInterval(fetchInterval)
    }
  }, [wantSats, playbackMode])

  // ── Air Quality (OpenAQ) — refresh every 10 minutes ──────────────────────
  useEffect(() => {
    if (!wantAirQ) {
      setAirQuality([])
      setLayerError('airq', null)
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantAirQ, aqCache, setAirQuality, () => fetchAirQuality(1000), 'airq')
      return
    }

    if (aqCache.current.length > 0) setAirQuality(aqCache.current)
    else setLayerLoading('airq', true)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      try {
        const stations = await fetchAirQuality(1000)
        if (stations.length) {
          aqCache.current = stations
          setAirQuality(stations)
          setLayerError('airq', null)
        } else if (aqCache.current.length === 0) {
          setLayerError('airq', 'No data received')
        }
      } catch (err) {
        console.error('[AirQ] Fetch failed:', err)
        setLayerError('airq', 'Fetch failed')
      } finally {
        setLayerLoading('airq', false)
      }
    }

    poll()
    const interval = setInterval(poll, 10 * 60_000)
    return () => clearInterval(interval)
  }, [wantAirQ, playbackMode])


  // ── GPS Jamming (gpsjam.org) — refresh every 6 hours (daily data) ────────
  useEffect(() => {
    if (!wantGpsJam) {
      setGpsJam([])
      setLayerError('gpsjam', null)
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantGpsJam, gpsJamCache, setGpsJam, fetchGpsJamData, 'gpsjam')
      return
    }

    if (gpsJamCache.current.length > 0) setGpsJam(gpsJamCache.current)
    else setLayerLoading('gpsjam', true)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      try {
        const cells = await fetchGpsJamData()
        if (cells.length) {
          gpsJamCache.current = cells
          setGpsJam(cells)
          setLayerError('gpsjam', null)
        } else if (gpsJamCache.current.length === 0) {
          setLayerError('gpsjam', 'No data received')
        }
      } catch (err) {
        console.error('[GPSJam] Fetch failed:', err)
        setLayerError('gpsjam', 'Fetch failed')
      } finally {
        setLayerLoading('gpsjam', false)
      }
    }

    poll()
    const interval = setInterval(poll, 6 * 60 * 60_000) // refresh every 6h
    return () => clearInterval(interval)
  }, [wantGpsJam, playbackMode])

  // ── Traffic (Overpass) — fetch road network for camera viewport ─────────
  const cameraBbox = useStore((s) => s.cameraBbox)
  const cameraHeight = useStore((s) => s.cameraHeight)

  useEffect(() => {
    if (!wantTraffic) {
      setRoadSegments([])
      return
    }

    // Only fetch roads when zoomed in enough (< ~80km altitude)
    if (!cameraBbox || cameraHeight > 80_000) {
      return // keep existing segments visible — don't clear
    }

    let cancelled = false
    // Debounce: wait 1s after camera stops before fetching
    const timer = setTimeout(() => {
      ;(async () => {
        const segments = await fetchRoadNetworkByBbox(cameraBbox, `viewport`)
        if (!cancelled && segments.length > 0) setRoadSegments(segments)
      })()
    }, 1000)

    return () => { cancelled = true; clearTimeout(timer) }
    // Stringify bbox to avoid re-renders from array identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTraffic, cameraBbox?.[0], cameraBbox?.[1], cameraBbox?.[2], cameraBbox?.[3], cameraHeight > 80_000])

  return { flights, militaryFlights, vessels, seismicEvents, wildfires, sats, airQuality, gpsJam, roadSegments }
}
