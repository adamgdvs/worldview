uniform sampler2D colorTexture;
uniform float u_blockSize;

in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;

  // Map u_blockSize (0–1) to grid resolution: 0 = 512 (fine, invisible), 1 = 32 (coarse mosaic)
  float gridSize = mix(512.0, 32.0, u_blockSize);

  // Snap UV to grid
  vec2 snapped = floor(uv * gridSize + 0.5) / gridSize;

  out_FragColor = texture(colorTexture, snapped);
}
