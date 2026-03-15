// AISStream.io WebSocket Integration
// Real-time maritime data

export interface VesselState {
  mmsi: number;
  name: string;
  type: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  status: number;
  lastUpdate: number;
}

export class AISAdapter {
  private socket: WebSocket | null = null;
  private apiKey: string;
  private onMessage: (vessel: VesselState) => void;
  private intentionalDisconnect = false;
  private reconnectDelay = 5_000;
  private msgCount = 0;

  constructor(apiKey: string, onMessage: (vessel: VesselState) => void) {
    this.apiKey = apiKey;
    this.onMessage = onMessage;
  }

  connect() {
    if (this.socket || !this.apiKey || this.apiKey.includes('your_')) {
      console.warn('[AIS] Skipping connect:', !this.apiKey ? 'no key' : this.apiKey.includes('your_') ? 'placeholder key' : 'already connected');
      return;
    }
    this.intentionalDisconnect = false;

    // In dev, proxy through Vite; in production, connect directly to AISStream
    const wsUrl = import.meta.env.DEV
      ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ais-ws`
      : 'wss://stream.aisstream.io/v0/stream';
    console.log('[AIS] Connecting to', wsUrl);
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('[AIS] Connected, sending subscription');
      this.reconnectDelay = 5_000;
      const subscription = {
        Apikey: this.apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport'],
      };
      this.socket?.send(JSON.stringify(subscription));
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Log first message and every 100th thereafter
        this.msgCount++;
        if (this.msgCount === 1 || this.msgCount % 100 === 0) {
          console.log(`[AIS] Messages received: ${this.msgCount}, type: ${data.MessageType}`);
        }

        // Handle error responses from server
        if (data.ERROR || data.error) {
          console.error('[AIS] Server error:', data.ERROR || data.error);
          return;
        }

        const msg = data.MessageType === 'PositionReport'
          ? data.Message.PositionReport
          : data.MessageType === 'StandardClassBPositionReport'
          ? data.Message.StandardClassBPositionReport
          : null;

        if (msg) {
          const vessel: VesselState = {
            mmsi: data.MetaData.MMSI,
            name: data.MetaData.ShipName?.trim() || 'UNKNOWN',
            type: data.MetaData.ShipType,
            latitude: msg.Latitude,
            longitude: msg.Longitude,
            speed: msg.Sog,
            course: msg.Cog,
            status: msg.NavigationalStatus ?? 0,
            lastUpdate: Date.now(),
          };
          this.onMessage(vessel);
        }
      } catch (err) {
        console.error('[AIS] Parse error:', err, event.data?.slice?.(0, 200));
      }
    };

    this.socket.onclose = (event) => {
      console.log(`[AIS] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
      this.socket = null;
      if (!this.intentionalDisconnect) {
        console.log(`[AIS] Reconnecting in ${this.reconnectDelay / 1000}s...`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000); // cap at 30s
      }
    };

    this.socket.onerror = (error) => {
      console.error('AISStream error:', error);
    };
  }

  disconnect() {
    this.intentionalDisconnect = true;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
