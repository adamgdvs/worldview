uniform sampler2D colorTexture;
uniform float u_noise;
uniform float u_scanlines;
uniform float u_vignette;

in vec2 v_textureCoordinates;

// SIGINT — signals intelligence. An intercepted-transmission look: deep
// blue basemap, horizontal RF interference tears that displace scan rows,
// a drifting waterfall band, and entity markers pulsing like RF emitters.

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_textureCoordinates;

  // --- Horizontal interference tears: whole scan rows displaced sideways ---
  float rowBlock = floor(uv.y * 90.0);
  float tearSeed = rand(vec2(rowBlock, floor(czm_frameNumber * 0.08)));
  // Rare tears: only ~6% of rows shift in any given moment
  float tear = step(0.94, tearSeed) * (tearSeed - 0.94) * 16.6;   // 0..1
  vec2 sampleUV = uv + vec2(tear * 0.025 * u_noise * (rand(vec2(rowBlock, 3.7)) - 0.5) * 2.0, 0.0);

  vec4 color = texture(colorTexture, sampleUV);
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // --- Deep blue signal-map base ---
  vec3 sig = vec3(0.01, 0.03, 0.08)                     // floor
           + lum * vec3(0.10, 0.24, 0.75);              // blue-shifted terrain

  // --- Waterfall band: a slow-descending horizontal strip of spectral noise ---
  float bandY = fract(czm_frameNumber * 0.0012);
  float inBand = 1.0 - smoothstep(0.0, 0.035, abs(uv.y - bandY));
  float spectral = rand(vec2(floor(uv.x * 220.0), floor(czm_frameNumber * 0.15)));
  sig += inBand * spectral * vec3(0.05, 0.35, 0.6) * 0.5;

  // --- Entities as pulsing RF emitters (keep their layer colors) ---
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float sat = maxC > 0.01 ? (maxC - minC) / maxC : 0.0;
  float entity = smoothstep(0.5, 0.8, sat) * smoothstep(0.3, 0.55, maxC);
  float pulse = 0.85 + 0.35 * sin(czm_frameNumber * 0.12);
  sig = mix(sig, color.rgb * pulse * 1.2, entity * 0.9);

  // --- Fine static ---
  float grain = rand(uv * (czm_frameNumber * 0.0001 + 3.0)) * 2.0 - 1.0;
  sig += grain * u_noise * 0.035;

  // --- Raster scan lines ---
  float scan = sin(uv.y * 600.0) * 0.5 + 0.5;
  sig *= 1.0 - u_scanlines * 0.1 * scan;

  // --- Vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.6, 1.5, dist * u_vignette);
  sig *= vig;

  out_FragColor = vec4(sig, color.a);
}
