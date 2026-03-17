import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { fetchFlights, type FlightState } from '../adapters/aviation'
import { AISAdapter, type VesselState } from '../adapters/maritime'
import { fetchSeismicEvents, type SeismicEvent } from '../adapters/seismic'
import { fetchWildfires, type WildfireHotspot } from '../adapters/wildfire'
import { fetchSatellites, propagateAll, propagateAllAtTime, type SatelliteState } from '../adapters/satellites'
import { fetchAirQuality, type AQStation } from '../adapters/airquality'
import { fetchWeather, type WeatherPoint } from '../adapters/weather'
import { fetchGpsJamData, type GpsJamCell } from '../adapters/gpsjam'
import { fetchRoadNetworkByBbox, type RoadSegment } from '../adapters/traffic'
import { loadGlobalCCTVFeeds, type CCTVFeed } from '../adapters/cctv'
import { useStore } from '../store'

export function useEntities(playbackTimeRef?: MutableRefObject<number>) {
  const [flights, setFlights] = useState<Map<string, FlightState>>(new Map())
  const [militaryFlights, setMilitaryFlights] = useState<Map<string, FlightState>>(new Map())
  const [vessels, setVessels] = useState<Map<number, VesselState>>(new Map())
  const [seismicEvents, setSeismicEvents] = useState<SeismicEvent[]>([])
  const [wildfires, setWildfires] = useState<WildfireHotspot[]>([])
  const [sats, setSats] = useState<SatelliteState[]>([])
  const [airQuality, setAirQuality] = useState<AQStation[]>([])
  const [weather, setWeather] = useState<WeatherPoint[]>([])
  const [gpsJam, setGpsJam] = useState<GpsJamCell[]>([])
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([])
  const [cctvFeeds, setCctvFeeds] = useState<CCTVFeed[]>([])
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
  const weatherCache = useRef<WeatherPoint[]>([])
  const gpsJamCache  = useRef<GpsJamCell[]>([])

  // Derive individual booleans so each effect only re-runs when its own layer toggles
  const wantCivil    = activeLayers.includes('avi-civil')
  const wantMil      = activeLayers.includes('avi-mil')
  const wantMaritime = activeLayers.includes('maritime')
  const wantSeismic  = activeLayers.includes('seismic')
  const wantFires    = activeLayers.includes('fires')
  const wantSats     = activeLayers.includes('satellites')
  const wantAirQ     = activeLayers.includes('airq')
  const wantWeather  = activeLayers.includes('weather')
  const wantGpsJam   = activeLayers.includes('gpsjam')
  const wantTraffic  = activeLayers.includes('traffic')
  const wantCctv     = activeLayers.includes('cctv')

  // ── Aviation (civil + military) ──────────────────────────────────────────
  useEffect(() => {
    if (!wantCivil && !wantMil) {
      setFlights(new Map())
      setMilitaryFlights(new Map())
      return
    }

    if (playbackMode) {
      // In playback: do a one-time snapshot fetch so there's data to display
      // Use cache if available, otherwise fetch live data as a snapshot
      if (civilCache.current.size > 0 || milCache.current.size > 0) {
        if (wantCivil) setFlights(civilCache.current)
        if (wantMil) setMilitaryFlights(milCache.current)
      } else {
        // Fetch once for playback snapshot
        const fetchSnapshot = async () => {
          const bbox = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
          const allFlights = await fetchFlights(bbox)
          if (!allFlights.length) return

          const civil = new Map<string, FlightState>()
          const mil   = new Map<string, FlightState>()
          for (const f of allFlights) {
            if (f.latitude == null || f.longitude == null || f.on_ground) continue
            if (f.military) mil.set(f.icao24, f)
            else civil.set(f.icao24, f)
          }
          civilCache.current = civil
          milCache.current = mil
          if (wantCivil) setFlights(civil)
          if (wantMil) setMilitaryFlights(mil)
        }
        fetchSnapshot()
      }
      return
    }

    // Instant restore from cache
    if (wantCivil && civilCache.current.size > 0) setFlights(civilCache.current)
    if (wantMil && milCache.current.size > 0) setMilitaryFlights(milCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const bbox = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }
      const allFlights = await fetchFlights(bbox)
      if (!allFlights.length) return

      const now = Date.now() / 1000
      const civil = new Map<string, FlightState>()
      const mil   = new Map<string, FlightState>()

      for (const f of allFlights) {
        if (
          f.latitude === null || f.longitude === null ||
          f.latitude < -90 || f.latitude > 90 ||
          f.longitude < -180 || f.longitude > 180 ||
          f.on_ground ||
          now - f.last_contact >= 300
        ) continue

        if (f.military) {
          mil.set(f.icao24, f)
        } else {
          civil.set(f.icao24, f)
        }
      }

      // Update cache
      civilCache.current = civil
      milCache.current = mil

      if (wantCivil) setFlights(civil)
      else setFlights(new Map())

      if (wantMil) setMilitaryFlights(mil)
      else setMilitaryFlights(new Map())
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
      return
    }

    const apiKey = import.meta.env.VITE_AISSTREAM_API_KEY
    if (!apiKey || apiKey.includes('your_')) {
      console.warn('[Maritime] No valid API key found')
      return
    }

    if (!aisAdapterRef.current) {
      aisAdapterRef.current = new AISAdapter(apiKey, (vessel) => {
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
      })
      aisAdapterRef.current.connect()
    }
  }, [wantMaritime, playbackMode])

  // Helper: one-time fetch for playback mode if cache is empty
  const playbackFetchOnce = <T,>(
    want: boolean,
    cache: React.MutableRefObject<T[]>,
    setter: (v: T[]) => void,
    fetcher: () => Promise<T[]>,
  ) => {
    if (!want) { setter([]); return }
    if (cache.current.length > 0) {
      setter(cache.current)
    } else {
      fetcher().then((data) => {
        if (data.length) {
          cache.current = data
          setter(data)
        }
      })
    }
  }

  // ── Seismic (USGS) — refresh every 5 minutes ───────────────────────────────
  useEffect(() => {
    if (!wantSeismic) {
      setSeismicEvents([])
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantSeismic, seismicCache, setSeismicEvents, () => fetchSeismicEvents(2.5, 200))
      return
    }

    // Instant restore from cache
    if (seismicCache.current.length > 0) setSeismicEvents(seismicCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const events = await fetchSeismicEvents(2.5, 200)
      if (events.length) {
        seismicCache.current = events
        setSeismicEvents(events)
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
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantFires, fireCache, setWildfires, fetchWildfires)
      return
    }

    // Instant restore from cache
    if (fireCache.current.length > 0) setWildfires(fireCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const hotspots = await fetchWildfires()
      if (hotspots.length) {
        fireCache.current = hotspots
        setWildfires(hotspots)
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
      return
    }

    let cancelled = false

    // Instant restore from cache
    if (satCache.current.length > 0) setSats(satCache.current)

    // Initial TLE fetch (slow, runs once) — needed for both live and playback
    const init = async () => {
      const states = await fetchSatellites(['stations'])
      if (cancelled) return
      if (states.length) {
        satCache.current = states
        setSats(states)
      }
    }
    init()

    // Fast propagation timer — re-compute positions from stored TLEs every 3s
    const propInterval = setInterval(() => {
      if (cancelled) return
      // In playback mode, propagate to playback time
      const propDate = (useStore.getState().playbackMode && playbackTimeRef?.current)
        ? new Date(playbackTimeRef.current)
        : new Date()
      const states = useStore.getState().playbackMode
        ? propagateAllAtTime(propDate)
        : propagateAll()
      if (states.length) {
        satCache.current = states
        setSats(states)
      }
    }, 3_000)

    // Re-fetch TLEs every 10 minutes (skip in playback mode)
    const fetchInterval = setInterval(async () => {
      if (useStore.getState().playbackMode) return
      const states = await fetchSatellites(['stations'])
      if (cancelled) return
      if (states.length) {
        satCache.current = states
        setSats(states)
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
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantAirQ, aqCache, setAirQuality, () => fetchAirQuality(1000))
      return
    }

    if (aqCache.current.length > 0) setAirQuality(aqCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const stations = await fetchAirQuality(1000)
      if (stations.length) {
        aqCache.current = stations
        setAirQuality(stations)
      }
    }

    poll()
    const interval = setInterval(poll, 10 * 60_000)
    return () => clearInterval(interval)
  }, [wantAirQ, playbackMode])

  // ── Weather (Open-Meteo) — refresh every 15 minutes ─────────────────────
  useEffect(() => {
    if (!wantWeather) {
      setWeather([])
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantWeather, weatherCache, setWeather, fetchWeather)
      return
    }

    if (weatherCache.current.length > 0) setWeather(weatherCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const points = await fetchWeather()
      if (points.length) {
        weatherCache.current = points
        setWeather(points)
      }
    }

    poll()
    const interval = setInterval(poll, 15 * 60_000)
    return () => clearInterval(interval)
  }, [wantWeather, playbackMode])

  // ── GPS Jamming (gpsjam.org) — refresh every 6 hours (daily data) ────────
  useEffect(() => {
    if (!wantGpsJam) {
      setGpsJam([])
      return
    }

    if (playbackMode) {
      playbackFetchOnce(wantGpsJam, gpsJamCache, setGpsJam, fetchGpsJamData)
      return
    }

    if (gpsJamCache.current.length > 0) setGpsJam(gpsJamCache.current)

    const poll = async () => {
      if (useStore.getState().playbackMode) return
      const cells = await fetchGpsJamData()
      if (cells.length) {
        gpsJamCache.current = cells
        setGpsJam(cells)
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

    // Only fetch roads when zoomed in enough (< ~50km altitude)
    if (!cameraBbox || cameraHeight > 50_000) {
      setRoadSegments([])
      return
    }

    let cancelled = false
    // Debounce: wait 800ms after camera stops before fetching
    const timer = setTimeout(() => {
      ;(async () => {
        const segments = await fetchRoadNetworkByBbox(cameraBbox, `viewport`)
        if (!cancelled) setRoadSegments(segments)
      })()
    }, 800)

    return () => { cancelled = true; clearTimeout(timer) }
    // Stringify bbox to avoid re-renders from array identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTraffic, cameraBbox?.[0], cameraBbox?.[1], cameraBbox?.[2], cameraBbox?.[3], cameraHeight > 50_000])

  // ── CCTV feeds — global preload from Windy webcam API ──────────────────
  useEffect(() => {
    if (!wantCctv) {
      setCctvFeeds([])
      return
    }

    // Start (or resume) global webcam load — feeds stream in via callback
    const unsubscribe = loadGlobalCCTVFeeds((feeds) => {
      setCctvFeeds(feeds)
    })

    return unsubscribe
  }, [wantCctv])

  return { flights, militaryFlights, vessels, seismicEvents, wildfires, sats, airQuality, weather, gpsJam, roadSegments, cctvFeeds }
}
