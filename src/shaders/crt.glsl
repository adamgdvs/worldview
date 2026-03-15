uniform sampler2D colorTexture;
uniform float u_distortion;
uniform float u_scanlines;
uniform float u_chromatic;

in vec2 v_textureCoordinates;

vec2 barrelDistort(vec2 uv, float amt) {
  vec2 cc = uv - 0.5;
  float dist = dot(cc, cc);
  return uv + cc * dist * amt;
}

void main() {
  vec2 uv = v_textureCoordinates;

  // --- Barrel distortion ---
  float distAmt = u_distortion * 0.3;
  vec2 distUV = barrelDistort(uv, distAmt);

  // Discard pixels outside [0,1] after distortion
  if (distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // --- Chromatic aberration ---
  float chromAmt = u_chromatic * 0.003;
  vec2 dir = distUV - 0.5;
  float r = texture(colorTexture, distUV + dir * chromAmt).r;
  float g = texture(colorTexture, distUV).g;
  float b = texture(colorTexture, distUV - dir * chromAmt).b;
  vec3 color = vec3(r, g, b);

  // --- Scanlines ---
  float scanline = sin(distUV.y * 900.0) * 0.5 + 0.5;
  color *= 1.0 - u_scanlines * 0.2 * scanline;

  // --- Phosphor glow (slight green push + brightness boost on bright areas) ---
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  color += vec3(0.0, 0.02, 0.01) * lum;

  // --- Vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.8, 1.6, dist);
  color *= vig;

  out_FragColor = vec4(color, 1.0);
}
