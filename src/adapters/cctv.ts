export interface CCTVFeed {
  id: string
  name: string
  latitude: number
  longitude: number
  imageUrl: string
  refreshInterval: number  // ms
  source: string
  city: string
}

// Curated static registry of known-good public CCTV feeds
// TfL JamCams are CORS-friendly and reliable
const FEED_REGISTRY: CCTVFeed[] = [
  // London — TfL JamCams
  { id: 'tfl-01', name: 'Trafalgar Square',    latitude: 51.5080, longitude: -0.1281, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06807.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-02', name: 'Park Lane',           latitude: 51.5069, longitude: -0.1537, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06811.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-03', name: 'Tower Bridge',        latitude: 51.5055, longitude: -0.0754, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.01251.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-04', name: 'Westminster Bridge',  latitude: 51.5008, longitude: -0.1215, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06831.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-05', name: 'Elephant & Castle',   latitude: 51.4945, longitude: -0.1006, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04619.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-06', name: 'Vauxhall Bridge',     latitude: 51.4873, longitude: -0.1271, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06805.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-07', name: 'Marylebone Road',     latitude: 51.5225, longitude: -0.1556, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06825.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },
  { id: 'tfl-08', name: 'Euston Road',         latitude: 51.5267, longitude: -0.1294, imageUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06814.jpg', refreshInterval: 60_000, source: 'TfL JamCam', city: 'London' },

  // Washington DC — public DOT cams (image endpoints)
  { id: 'dc-01', name: '14th St & Constitution', latitude: 38.8913, longitude: -77.0328, imageUrl: 'https://opendata.dc.gov/datasets/traffic-camera/api', refreshInterval: 120_000, source: 'DC DOT', city: 'Washington DC' },
  { id: 'dc-02', name: 'Capitol Hill',           latitude: 38.8899, longitude: -77.0091, imageUrl: 'https://opendata.dc.gov/datasets/traffic-camera/api', refreshInterval: 120_000, source: 'DC DOT', city: 'Washington DC' },

  // New York — NYC DOT (placeholder URLs — actual feeds need proxy)
  { id: 'nyc-01', name: 'Times Square',    latitude: 40.7580, longitude: -73.9855, imageUrl: 'https://webcams.nyctmc.org/api/cameras/brooklyn-bridge', refreshInterval: 120_000, source: 'NYC DOT', city: 'New York' },
  { id: 'nyc-02', name: 'Brooklyn Bridge', latitude: 40.7061, longitude: -73.9969, imageUrl: 'https://webcams.nyctmc.org/api/cameras/times-square',    refreshInterval: 120_000, source: 'NYC DOT', city: 'New York' },
]

export function getCCTVFeeds(city?: string): CCTVFeed[] {
  if (!city || city === 'Global') return FEED_REGISTRY
  return FEED_REGISTRY.filter(f => f.city === city)
}

export async function fetchCCTVSnapshot(feed: CCTVFeed): Promise<string | null> {
  try {
    const res = await fetch(feed.imageUrl, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}
