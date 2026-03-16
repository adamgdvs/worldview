import { useEffect, useRef, useState } from 'react'
import { fetchFlights, type FlightState } from '../adapters/aviation'
import { AISAdapter, type VesselState } from '../adapters/maritime'
import { fetchSeismicEvents, type SeismicEvent } from '../adapters/seismic'
import { fetchWildfires, type WildfireHotspot } from '../adapters/wildfire'
import { fetchSatellites, propagateAll, type SatelliteState } from '../adapters/satellites'
import { fetchAirQuality, type AQStation } from '../adapters/airquality'
import { fetchWeather, type WeatherPoint } from '../adapters/weather'
import { fetchGpsJamData, type GpsJamCell } from '../adapters/gpsjam'
import { fetchRoadNetwork, type RoadSegment } from '../adapters/traffic'
import { getCCTVFeeds, type CCTVFeed } from '../adapters/cctv'
import { useStore } from '../store'

export function useEntities() {
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
  const selectedCity = useStore((s) => s.selectedCity)
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

    // Instant restore from cache
    if (wantCivil && civilCache.current.size > 0) setFlights(civilCache.current)
    if (wantMil && milCache.current.size > 0) setMilitaryFlights(milCache.current)

    const poll = async () => {
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
  }, [wantCivil, wantMil])

  // ── Maritime WebSocket ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!wantMaritime) {
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
  }, [wantMaritime])

  // ── Seismic (USGS) — refresh every 5 minutes ───────────────────────────────
  useEffect(() => {
    if (!wantSeismic) {
      setSeismicEvents([])
      return
    }

    // Instant restore from cache
    if (seismicCache.current.length > 0) setSeismicEvents(seismicCache.current)

    const poll = async () => {
      const events = await fetchSeismicEvents(2.5, 200)
      if (events.length) {
        seismicCache.current = events
        setSeismicEvents(events)
      }
    }

    poll()
    const interval = setInterval(poll, 5 * 60_000)
    return () => clearInterval(interval)
  }, [wantSeismic])

  // ── Wildfire (NASA FIRMS) — refresh every 15 minutes ─────────────────────
  useEffect(() => {
    if (!wantFires) {
      setWildfires([])
      return
    }

    // Instant restore from cache
    if (fireCache.current.length > 0) setWildfires(fireCache.current)

    const poll = async () => {
      const hotspots = await fetchWildfires()
      if (hotspots.length) {
        fireCache.current = hotspots
        setWildfires(hotspots)
      }
    }

    poll()
    const interval = setInterval(poll, 15 * 60_000)
    return () => clearInterval(interval)
  }, [wantFires])

  // ── Satellites — fetch TLEs once, propagate positions every 3s ────────────
  useEffect(() => {
    if (!wantSats) {
      setSats([])
      return
    }

    let cancelled = false

    // Instant restore from cache
    if (satCache.current.length > 0) setSats(satCache.current)

    // Initial TLE fetch (slow, runs once)
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
      const states = propagateAll()
      if (states.length) {
        satCache.current = states
        setSats(states)
      }
    }, 3_000)

    // Re-fetch TLEs every 10 minutes to pick up new satellites
    const fetchInterval = setInterval(async () => {
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
  }, [wantSats])

  // ── Air Quality (OpenAQ) — refresh every 10 minutes ──────────────────────
  useEffect(() => {
    if (!wantAirQ) {
      setAirQuality([])
      return
    }

    if (aqCache.current.length > 0) setAirQuality(aqCache.current)

    const poll = async () => {
      const stations = await fetchAirQuality(1000)
      if (stations.length) {
        aqCache.current = stations
        setAirQuality(stations)
      }
    }

    poll()
    const interval = setInterval(poll, 10 * 60_000)
    return () => clearInterval(interval)
  }, [wantAirQ])

  // ── Weather (Open-Meteo) — refresh every 15 minutes ─────────────────────
  useEffect(() => {
    if (!wantWeather) {
      setWeather([])
      return
    }

    if (weatherCache.current.length > 0) setWeather(weatherCache.current)

    const poll = async () => {
      const points = await fetchWeather()
      if (points.length) {
        weatherCache.current = points
        setWeather(points)
      }
    }

    poll()
    const interval = setInterval(poll, 15 * 60_000)
    return () => clearInterval(interval)
  }, [wantWeather])

  // ── GPS Jamming (gpsjam.org) — refresh every 6 hours (daily data) ────────
  useEffect(() => {
    if (!wantGpsJam) {
      setGpsJam([])
      return
    }

    if (gpsJamCache.current.length > 0) setGpsJam(gpsJamCache.current)

    const poll = async () => {
      const cells = await fetchGpsJamData()
      if (cells.length) {
        gpsJamCache.current = cells
        setGpsJam(cells)
      }
    }

    poll()
    const interval = setInterval(poll, 6 * 60 * 60_000) // refresh every 6h
    return () => clearInterval(interval)
  }, [wantGpsJam])

  // ── Traffic (Overpass) — fetch road network per city ────────────────────
  useEffect(() => {
    if (!wantTraffic) {
      setRoadSegments([])
      return
    }

    let cancelled = false
    ;(async () => {
      const segments = await fetchRoadNetwork(selectedCity)
      if (!cancelled) setRoadSegments(segments)
    })()

    return () => { cancelled = true }
  }, [wantTraffic, selectedCity])

  // ── CCTV feeds — Windy Webcams API, nearby search per city ─────────────
  useEffect(() => {
    if (!wantCctv) {
      setCctvFeeds([])
      return
    }

    let cancelled = false
    ;(async () => {
      console.info(`[CCTV useEntities] Fetching feeds for "${selectedCity}"...`)
      const feeds = await getCCTVFeeds(selectedCity)
      console.info(`[CCTV useEntities] Got ${feeds.length} feeds, cancelled=${cancelled}`)
      if (!cancelled) {
        console.info(`[CCTV useEntities] Setting state with ${feeds.length} feeds`)
        setCctvFeeds(feeds)
      }
    })()

    // Re-fetch every 8 minutes (Windy free tier tokens expire at 10 min)
    const interval = setInterval(async () => {
      const feeds = await getCCTVFeeds(selectedCity)
      if (!cancelled) setCctvFeeds(feeds)
    }, 8 * 60_000)

    return () => { cancelled = true; clearInterval(interval) }
  }, [wantCctv, selectedCity])

  return { flights, militaryFlights, vessels, seismicEvents, wildfires, sats, airQuality, weather, gpsJam, roadSegments, cctvFeeds }
}
