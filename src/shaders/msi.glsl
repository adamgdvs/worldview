uniform sampler2D colorTexture;
uniform float u_noise;
uniform float u_scanlines;
uniform float u_vignette;

in vec2 v_textureCoordinates;

// MSI — multispectral imagery, color-infrared (CIR) false color. The classic
// Landsat/NAIP analysis palette: healthy vegetation renders bright red
// (strong NIR proxy from green dominance), water renders near-black blue,
// bare soil / urban renders cyan-gray. Purpose: instant land-cover reading —
// vegetation health, waterways, and built-up areas separate at a glance.

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  vec3 rgb = clamp(color.rgb, 0.0, 1.0);
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));

  float r = rgb.r, g = rgb.g, b = rgb.b;

  // Space / void: the scene background is near-black but NOT zero, and the
  // NDVI ratio explodes at tiny values (dark blue → "vegetation"). Gate on
  // luminance and pass the void through darkened.
  if (lum < 0.03) {
    out_FragColor = vec4(rgb * 0.5, color.a);
    return;
  }

  // --- Pseudo-NDVI from green dominance (proxy for NIR reflectance) ---
  // Threshold starts at 0.09 — murky harbor water has slight green
  // dominance (ndvi ~0.05) and must not read as vegetation
  float ndvi = (g - r) / max(g + r, 0.02);
  // Luminance confidence term: dark pixels (shadow, water edges) carry too
  // little signal for the green-dominance proxy — fade classification out
  float veg = smoothstep(0.09, 0.34, ndvi) * smoothstep(0.06, 0.16, lum);

  // --- Water: bluer than red and dark. Real harbor water in satellite
  // imagery is murky green-brown (g ≥ b), so compare against red instead ---
  // (1 - smoothstep) instead of reversed edges — reversed-edge smoothstep is
  // undefined in GLSL and renders garbage on some GPUs
  float wat = smoothstep(0.0, 0.10, b - r) * (1.0 - smoothstep(0.15, 0.45, lum)) * (1.0 - veg);

  // --- Base: urban/soil as cool cyan-gray, keeps structural detail ---
  vec3 msi = vec3(lum * 0.75, lum * 0.88, lum * 0.95);

  // Vegetation → red channel (brighter canopy = more vigorous growth)
  vec3 vegColor = vec3(0.55 + lum * 0.75, lum * 0.22, lum * 0.20);
  msi = mix(msi, vegColor, veg);

  // Water → deep blue-black
  vec3 watColor = vec3(0.01, 0.04, 0.10 + lum * 0.15);
  msi = mix(msi, watColor, wat);

  // --- Preserve entity markers (keep layer color-coding) ---
  float maxC = max(r, max(g, b));
  float minC = min(r, min(g, b));
  float sat = maxC > 0.01 ? (maxC - minC) / maxC : 0.0;
  float entity = smoothstep(0.5, 0.8, sat) * smoothstep(0.3, 0.55, maxC);
  msi = mix(msi, color.rgb * 1.15, entity * 0.9);

  // --- Sensor grain ---
  float grain = rand(uv * (czm_frameNumber * 0.0001 + 5.0)) * 2.0 - 1.0;
  msi += grain * u_noise * 0.03;

  // --- Subtle raster lines ---
  float scan = sin(uv.y * 700.0) * 0.5 + 0.5;
  msi *= 1.0 - u_scanlines * 0.05 * scan;

  // --- Vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.7, 1.6, dist * u_vignette);
  msi *= vig;

  out_FragColor = vec4(msi, color.a);
}
