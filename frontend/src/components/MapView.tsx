import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import type { StreamState } from '../lib/stream'
import type { Connection } from '../types'
import { Card, CardHeader } from './ui'

const PIN: Record<Connection, string> = {
  connected: '#0ca30c',
  degraded: '#fab219',
  disconnected: '#d03b3b',
}

/* Pins are built from markup rather than image assets so the color can carry
   live connection state. Identity never rests on color alone: the popup and
   the list below both name the state in words. */
function stateIcon(state: Connection) {
  return divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;
      background:${PIN[state]};border:2px solid #0f172a;
      box-shadow:0 0 0 2px ${PIN[state]}55"></span>`,
  })
}

interface Weather {
  temp: number
  wind: number
  code: number
}

const WEATHER_TEXT: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers',
  81: 'Rain showers', 82: 'Violent showers', 95: 'Thunderstorm',
}

/* Open-Meteo: free, no API key. */
function useWeather(lat: number | null, lon: number | null) {
  const [weather, setWeather] = useState<Weather | null>(null)
  useEffect(() => {
    if (lat == null || lon == null) return
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,wind_speed_10m,weather_code`
    let cancelled = false
    const load = () =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d.current) return
          setWeather({
            temp: d.current.temperature_2m,
            wind: d.current.wind_speed_10m,
            code: d.current.weather_code,
          })
        })
        .catch(() => undefined)
    load()
    const timer = window.setInterval(load, 10 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [lat, lon])
  return weather
}

export function MapView({ stream }: { stream: StreamState }) {
  const located = stream.intersections.filter(
    (i) => i.lat != null && i.lon != null,
  )
  const first = located[0]
  const weather = useWeather(first?.lat ?? null, first?.lon ?? null)

  if (located.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-100">Map</h2>
        </CardHeader>
        <div className="space-y-2 px-4 py-10 text-center">
          <p className="text-sm text-slate-400">
            No intersection has coordinates yet.
          </p>
          <p className="text-xs text-slate-500">
            Add <code className="text-slate-400">lat</code> and{' '}
            <code className="text-slate-400">lon</code> to an entry in{' '}
            <code className="text-slate-400">backend/intersections.json</code>.
          </p>
        </div>
      </Card>
    )
  }

  const center: [number, number] = [first.lat!, first.lon!]

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <h2 className="font-semibold text-slate-100">Network map</h2>
        {weather && (
          <span className="text-xs text-slate-400">
            {WEATHER_TEXT[weather.code] ?? 'Weather'} · {weather.temp}
            {'°'}C · wind {weather.wind} km/h
          </span>
        )}
      </CardHeader>
      <MapContainer
        center={center}
        zoom={16}
        scrollWheelZoom={false}
        style={{ height: 420, width: '100%', background: '#0f172a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map((i) => (
          <Marker
            key={i.id}
            position={[i.lat!, i.lon!]}
            icon={stateIcon(i.connection)}
          >
            <Popup>
              <span className="font-semibold">{i.name}</span>
              <br />
              {i.connection}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="divide-y divide-slate-800 border-t border-slate-800">
        {located.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: PIN[i.connection] }}
            />
            <span className="text-sm text-slate-200">{i.name}</span>
            <span className="text-xs capitalize text-slate-400">
              {i.connection}
            </span>
            <span className="tabular ml-auto text-xs text-slate-500">
              {i.lat!.toFixed(5)}, {i.lon!.toFixed(5)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
