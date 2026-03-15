// @ts-ignore
import { PostProcessStage, Viewer } from 'cesium'

import nvgSource from '../shaders/nvg.glsl?raw'
import flirSource from '../shaders/flir.glsl?raw'
import crtSource from '../shaders/crt.glsl?raw'

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

    pp.add(this.nvgStage)
    pp.add(this.flirStage)
    pp.add(this.crtStage)

    // All disabled by default
    this.nvgStage.enabled = false
    this.flirStage.enabled = false
    this.crtStage.enabled = false
  }

  setMode(mode: string) {
    this.currentMode = mode

    if (this.nvgStage) this.nvgStage.enabled = mode === 'NVG'
    if (this.flirStage) this.flirStage.enabled = mode === 'FLIR'
    if (this.crtStage) this.crtStage.enabled = mode === 'CRT'

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

    this.viewer.scene.requestRender()
  }

  destroy() {
    const pp = this.viewer.scene.postProcessStages
    if (this.nvgStage) { pp.remove(this.nvgStage); this.nvgStage = null }
    if (this.flirStage) { pp.remove(this.flirStage); this.flirStage = null }
    if (this.crtStage) { pp.remove(this.crtStage); this.crtStage = null }
  }
}

export { DEFAULT_PARAMS }
