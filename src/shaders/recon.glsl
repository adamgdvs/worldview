uniform sampler2D colorTexture;
uniform float u_noise;
uniform float u_scanlines;
uniform float u_vignette;

in vec2 v_textureCoordinates;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);

  // Luminance
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // Darken base for more dramatic contrast
  float darkLum = pow(lum, 1.4) * 0.7;

  // High-contrast black & white reconnaissance film
  float contrast = smoothstep(0.08, 0.75, darkLum);
  vec3 recon = vec3(contrast);

  // Slight warm tone (aged film)
  recon *= vec3(1.05, 1.0, 0.88);

  // Detect bright entity nodes
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float sat = maxC > 0.01 ? (maxC - minC) / maxC : 0.0;
  float entity = smoothstep(0.45, 0.75, sat) * smoothstep(0.25, 0.5, maxC);

  // Render entities as bright pure white (pops on dark B&W)
  recon = mix(recon, vec3(1.0, 1.0, 0.97), entity);

  // Film grain
  float grain = rand(uv * czm_frameNumber * 0.013) * 2.0 - 1.0;
  recon += grain * u_noise * 0.06;

  // Horizontal scan lines (film strip effect)
  float scan = sin(uv.y * 800.0) * 0.5 + 0.5;
  recon *= 1.0 - u_scanlines * 0.08 * scan;

  // Edge darkening (lens vignette)
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.5, 1.4, dist * u_vignette);
  recon *= vig;

  out_FragColor = vec4(recon, color.a);
}
