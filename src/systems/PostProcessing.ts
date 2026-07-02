// @ts-ignore
import { PostProcessStage, Viewer } from 'cesium'

import nvgSource from '../shaders/nvg.glsl?raw'
import flirSource from '../shaders/flir.glsl?raw'
import crtSource from '../shaders/crt.glsl?raw'
import sigintSource from '../shaders/sigint.glsl?raw'
import reconSource from '../shaders/recon.glsl?raw'
import sarSource from '../shaders/sar.glsl?raw'
import msiSource from '../shaders/msi.glsl?raw'
import bloomSource from '../shaders/bloom.glsl?raw'
import pixelateSource from '../shaders/pixelate.glsl?raw'
import sharpenSource from '../shaders/sharpen.glsl?raw'

export interface ShaderParams {
  bloom: number
  sharpen: number
  scanlines: number
  grain: number
  distortion: number
  vignette: number
}

const DEFAULT_PARAMS: ShaderParams = {
  bloom: 100,
  sharpen: 34,
  scanlines: 50,
  grain: 50,
  distortion: 45,
  vignette: 70,
}

export class PostProcessManager {
  private viewer: Viewer
  private nvgStage: any | null = null
  private flirStage: any | null = null
  private crtStage: any | null = null
  private sigintStage: any | null = null
  private reconStage: any | null = null
  private sarStage: any | null = null
  private msiStage: any | null = null
  private bloomStage: any | null = null
  private pixelateStage: any | null = null
  private sharpenStage: any | null = null
  currentMode: string = 'NORMAL'

  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.initStages()
  }

  private initStages() {
    const pp = this.viewer.scene.postProcessStages

    this.nvgStage = new PostProcessStage({
      fragmentShader: nvgSource,
      uniforms: {
        u_grain: 0.5,
        u_scanlines: 0.5,
        u_vignette: 1.0,
      },
    })

    this.flirStage = new PostProcessStage({
      fragmentShader: flirSource,
      uniforms: {
        u_noise: 0.5,
        u_contrast: 0.8,
        u_vignette: 1.0,
      },
    })

    this.crtStage = new PostProcessStage({
      fragmentShader: crtSource,
      uniforms: {
        u_distortion: 0.45,
        u_scanlines: 0.5,
        u_chromatic: 0.5,
      },
    })

    this.sigintStage = new PostProcessStage({
      fragmentShader: sigintSource,
      uniforms: {
        u_noise: 0.5,
        u_scanlines: 0.5,
        u_vignette: 1.0,
      },
    })

    this.reconStage = new PostProcessStage({
      fragmentShader: reconSource,
      uniforms: {
        u_noise: 0.5,
        u_scanlines: 0.5,
        u_vignette: 1.0,
      },
    })

    this.sarStage = new PostProcessStage({
      fragmentShader: sarSource,
      uniforms: {
        u_noise: 0.5,
        u_scanlines: 0.5,
        u_vignette: 1.0,
      },
    })

    this.msiStage = new PostProcessStage({
      fragmentShader: msiSource,
      uniforms: {
        u_noise: 0.5,
        u_scanlines: 0.5,
        u_vignette: 1.0,
      },
    })

    this.bloomStage = new PostProcessStage({
      fragmentShader: bloomSource,
      uniforms: {
        u_intensity: 0.0,
      },
    })

    this.pixelateStage = new PostProcessStage({
      fragmentShader: pixelateSource,
      uniforms: {
        u_blockSize: 0.0,
      },
    })

    this.sharpenStage = new PostProcessStage({
      fragmentShader: sharpenSource,
      uniforms: {
        u_sharpen: 0.0,
      },
    })

    pp.add(this.nvgStage)
    pp.add(this.flirStage)
    pp.add(this.crtStage)
    pp.add(this.sigintStage)
    pp.add(this.reconStage)
    pp.add(this.sarStage)
    pp.add(this.msiStage)
    pp.add(this.bloomStage)
    pp.add(this.pixelateStage)
    pp.add(this.sharpenStage)

    // All disabled by default
    this.nvgStage.enabled = false
    this.flirStage.enabled = false
    this.crtStage.enabled = false
    this.sigintStage.enabled = false
    this.reconStage.enabled = false
    this.sarStage.enabled = false
    this.msiStage.enabled = false
    this.bloomStage.enabled = false
    this.pixelateStage.enabled = false
    this.sharpenStage.enabled = false
  }

  setMode(mode: string) {
    this.currentMode = mode

    if (this.nvgStage) this.nvgStage.enabled = mode === 'NVG'
    if (this.flirStage) this.flirStage.enabled = mode === 'FLIR'
    if (this.crtStage) this.crtStage.enabled = mode === 'CRT'
    if (this.sigintStage) this.sigintStage.enabled = mode === 'SIGINT'
    if (this.reconStage) this.reconStage.enabled = mode === 'RECON'
    if (this.sarStage) this.sarStage.enabled = mode === 'SAR'
    if (this.msiStage) this.msiStage.enabled = mode === 'MSI'

    this.viewer.scene.requestRender()
  }

  setParams(params: ShaderParams) {
    const norm = (v: number) => v / 100 // convert 0-100 to 0-1

    if (this.nvgStage) {
      this.nvgStage.uniforms.u_grain = norm(params.grain)
      this.nvgStage.uniforms.u_scanlines = norm(params.scanlines)
      this.nvgStage.uniforms.u_vignette = norm(params.vignette) * 1.4
    }

    if (this.flirStage) {
      this.flirStage.uniforms.u_noise = norm(params.grain)
      this.flirStage.uniforms.u_contrast = 0.3 + norm(params.sharpen) * 1.4
      this.flirStage.uniforms.u_vignette = norm(params.vignette) * 1.4
    }

    if (this.crtStage) {
      this.crtStage.uniforms.u_distortion = norm(params.distortion)
      this.crtStage.uniforms.u_scanlines = norm(params.scanlines)
      this.crtStage.uniforms.u_chromatic = norm(params.bloom) * 0.8
    }

    // SIGINT, RECON, SAR, MSI all share the same uniform names
    for (const stage of [this.sigintStage, this.reconStage, this.sarStage, this.msiStage]) {
      if (stage) {
        stage.uniforms.u_noise = norm(params.grain)
        stage.uniforms.u_scanlines = norm(params.scanlines)
        stage.uniforms.u_vignette = norm(params.vignette) * 1.4
      }
    }

    this.viewer.scene.requestRender()
  }

  setBloom(intensity: number) {
    if (this.bloomStage) {
      this.bloomStage.enabled = intensity > 0
      this.bloomStage.uniforms.u_intensity = intensity / 100
    }
    this.viewer.scene.requestRender()
  }

  setPixelate(size: number) {
    if (this.pixelateStage) {
      this.pixelateStage.enabled = size > 0
      this.pixelateStage.uniforms.u_blockSize = size / 100
    }
    this.viewer.scene.requestRender()
  }

  setSharpen(intensity: number) {
    if (this.sharpenStage) {
      this.sharpenStage.enabled = intensity > 0
      this.sharpenStage.uniforms.u_sharpen = intensity / 100
    }
    this.viewer.scene.requestRender()
  }

  destroy() {
    const pp = this.viewer.scene.postProcessStages
    if (this.nvgStage) { pp.remove(this.nvgStage); this.nvgStage = null }
    if (this.flirStage) { pp.remove(this.flirStage); this.flirStage = null }
    if (this.crtStage) { pp.remove(this.crtStage); this.crtStage = null }
    if (this.sigintStage) { pp.remove(this.sigintStage); this.sigintStage = null }
    if (this.reconStage) { pp.remove(this.reconStage); this.reconStage = null }
    if (this.sarStage) { pp.remove(this.sarStage); this.sarStage = null }
    if (this.msiStage) { pp.remove(this.msiStage); this.msiStage = null }
    if (this.bloomStage) { pp.remove(this.bloomStage); this.bloomStage = null }
    if (this.pixelateStage) { pp.remove(this.pixelateStage); this.pixelateStage = null }
    if (this.sharpenStage) { pp.remove(this.sharpenStage); this.sharpenStage = null }
  }
}

export { DEFAULT_PARAMS }
