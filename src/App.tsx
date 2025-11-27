import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  const numberOfRings = 9
  const [rotValues, setRotValues] = useState<number[]>(() => Array(numberOfRings).fill(1))
  // accumulated score: add product of rotValues each full rotation
  const [score, setScore] = useState<number>(0)
  // per-ring speed upgrade levels (each level adds 0.25x linear multiplier)
  const [speedLevels, setSpeedLevels] = useState<number[]>(() => Array(numberOfRings).fill(0))
  // ascension multipliers: each ascension doubles the per-rotation increment for that ring
  const [ascendMultipliers, setAscendMultipliers] = useState<number[]>(() => Array(numberOfRings).fill(1))
  // prestige system: earn prestige points by spending score at thresholds
  const [prestigePoints, setPrestigePoints] = useState<number>(0)
  const prestigeThreshold = 1000

  // perform prestige: convert score->prestige points, then reset everything except prestigePoints
  function doPrestige() {
    const gain = Math.floor(score / prestigeThreshold)
    if (gain <= 0) return
    setPrestigePoints((p) => p + gain)

    // reset gameplay state
    setScore(0)
    setRotValues(() => Array(numberOfRings).fill(1))
    setSpeedLevels(() => Array(numberOfRings).fill(0))
    setAscendMultipliers(() => Array(numberOfRings).fill(1))

    // clear canvases
    const trails = trailRefs.current
    if (trails) {
      for (let i = 0; i < trails.length; i++) {
        const t = trails[i]
        if (t) {
          const ctx = t.getContext('2d')
          if (ctx) ctx.clearRect(0, 0, t.width, t.height)
        }
      }
    }
    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height)
    }

    // reset internal refs used by the loop
    lastPosRef.current = Array(numberOfRings).fill(null)
    lastWholeRef.current = Array(numberOfRings).fill(0)
    startRef.current = null
  }

  // per-ring colors (HSL hues)
  const ringColors = Array.from({ length: numberOfRings }, (_, i) => `hsl(${(i * 360) / numberOfRings},70%,55%)`)

  const spinDuration = 2 // seconds for one full rotation
  const canvasSize = 380
  const trailRefs = useRef<(HTMLCanvasElement | null)[]>(Array(numberOfRings).fill(null))
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const lastWholeRef = useRef<number[]>(Array(numberOfRings).fill(0))
  const lastPosRef = useRef<({ x: number; y: number } | null)[]>(Array(numberOfRings).fill(null))
  
  // purchase an upgrade for ring i: consumes score and increases speed level
  function buyUpgrade(i: number) {
    const level = speedLevels[i] || 0
    const baseCost = 1
    const cost = baseCost * Math.pow(100, i) * (level + 1)
    if (score >= cost) {
      setScore((s) => +(s - cost).toFixed(4))
      setSpeedLevels((arr) => {
        const copy = [...arr]
        copy[i] = (copy[i] || 0) + 1
        return copy
      })
    }
  }

  // perform ascension for ring i: reset its level to 0 and double its ascension multiplier
  function ascend(i: number) {
    setSpeedLevels((arr) => {
      const copy = [...arr]
      copy[i] = 0
      return copy
    })
    setAscendMultipliers((arr) => {
      const copy = [...arr]
      copy[i] = (copy[i] || 1) * 2
      return copy
    })
  }
  useEffect(() => {
    const trails = trailRefs.current
    const overlay = overlayRef.current
    if (!overlay) return
    // ensure all trail canvases exist
    if (!trails || trails.length !== numberOfRings || trails.some((t) => t == null)) return

    // Use 1:1 canvas pixel size (no DPR scaling) so lineWidth maps directly to CSS pixels.
    const w = canvasSize
    const h = canvasSize
    for (let i = 0; i < numberOfRings; i++) {
      const t = trails[i]!
      t.width = w
      t.height = h
      t.style.width = `${w}px`
      t.style.height = `${h}px`
    }
    overlay.width = w
    overlay.height = h
    overlay.style.width = `${w}px`
    overlay.style.height = `${h}px`

    const ctxTrails = trails.map((t) => t!.getContext('2d')!)
    const ctxOverlay = overlay.getContext('2d')!

    const cx = w / 2
    const cy = h / 2
    const baseRadius = 40
    const spacing = 16
    // keep the inner ring's angular period as the reference (spinDuration)
    // compute a constant linear speed (pixels/sec) based on the inner ring
    const linearSpeed = (2 * Math.PI * baseRadius) / spinDuration

    function drawSegment(i: number, x: number, y: number, color: string, width = 2) {
      const last = lastPosRef.current[i]
      const ctx = ctxTrails[i]
      if (last) {
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(x, y)
        ctx.strokeStyle = color
        // use width directly (canvas is 1:1 with CSS pixels)
        ctx.lineWidth = width
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      lastPosRef.current[i] = { x, y }
    }

    function drawOverlay(x: number, y: number, color: string) {
      // draw a translucent small blob on the overlay using a lighter HSLA
      ctxOverlay.beginPath()
      // extract hue from the ring color (which is `hsl(h,s%,l%)`)
      const m = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/)
      const hue = m ? m[1] : '220'
      // use a lighter lightness and low alpha so blobs are colored but not dark
      ctxOverlay.fillStyle = `hsla(${hue},70%,70%,0.16)`
      ctxOverlay.arc(x, y, 9, 0, Math.PI * 2)
      ctxOverlay.fill()
      ctxOverlay.lineWidth = 3
      ctxOverlay.strokeStyle = `hsla(${hue},70%,50%,0.25)`
      ctxOverlay.stroke()
    }

    function loop(nowMs: number) {
      if (!startRef.current) startRef.current = nowMs
      const elapsed = (nowMs - startRef.current) / 1000

      // clear overlay per frame
      ctxOverlay.clearRect(0, 0, w, h)
      // subtle globalComposite to avoid full continuous ring: we keep overlay additive but trail is persistent dots

      // for each ring, compute position and draw, and check per-ring full rotations
      for (let i = 0; i < numberOfRings; i++) {
        const radius = baseRadius + i * spacing
        // compute per-ring angular velocity so tangential (linear) speed is constant
        // apply per-ring multiplier: only the red ring (index 0) is active initially
        const baseMult = i === 0 ? 1 : 0
        const multiplier = baseMult + (speedLevels[i] || 0) * 0.25
        const angVel = (linearSpeed * multiplier) / radius // radians per second
        // start from up (-90deg) and rotate clockwise (increasing angle)
        const angle = -Math.PI / 2 + angVel * elapsed
        const x = cx + Math.cos(angle) * radius
        const y = cy + Math.sin(angle) * radius

        const color = ringColors[i]

        // draw continuous segment from previous position to current (per-frame)
        const segWidth = 8
        drawSegment(i, x, y, color, segWidth)

        // draw the transparent moving object on overlay (all rings)
        drawOverlay(x, y, color)

        // per-ring full rotations (how many full revolutions this ring has completed)
        const revolutions = (angVel * elapsed) / (Math.PI * 2)
        const whole = Math.floor(revolutions)
        if (whole > lastWholeRef.current[i]) {
          // clear only this ring's trail canvas and reset its last position
          const ctx = ctxTrails[i]
          ctx.clearRect(0, 0, w, h)
          lastPosRef.current[i] = null
          lastWholeRef.current[i] = whole

          // increment only this ring's rot value and add its product to score
          // determine increment amount (base 0.01, scaled by ascension multiplier and prestige)
          const globalPrestigeMultiplier = 1 + (prestigePoints || 0) * 0.1
          const inc = 0.01 * (ascendMultipliers[i] || 1) * globalPrestigeMultiplier
          setRotValues((arr) => {
            const prod = arr.reduce((a, b) => a * b, 1)
            setScore((s) => s + prod)
            return arr.map((v, idx) => (idx === i ? +((v + inc).toFixed(2)) : v))
          })
        }
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="color-numbers" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
          {ringColors.map((c, i) => (
            <span key={i} style={{ color: c, fontWeight: 700 }}>
              {rotValues[i].toFixed(2)}{i < numberOfRings - 1 ? '×' : ''}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="score">Score: {score.toFixed(4)}</div>
          <div style={{ marginLeft: 8 }}>
            <div>Prestige points: {prestigePoints}</div>
            {Math.floor(score / prestigeThreshold) >= 1 && (
              <button onClick={doPrestige}>
                Prestige ×{Math.floor(score / prestigeThreshold)}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="rotation-area">
          <div className="canvas-wrap" style={{ width: canvasSize, height: canvasSize }}>
            {Array.from({ length: numberOfRings }).map((_, i) => (
              <canvas key={i} ref={(el) => { trailRefs.current[i] = el }} className="trail-canvas" />
            ))}
            <canvas ref={overlayRef} className="overlay-canvas" />
          </div>
          <div className="rot-values">
            {rotValues.map((v, i) => {
              const level = speedLevels[i] || 0
              const baseCost = 1
              const cost = baseCost * Math.pow(100, i) * (level + 1)
              const costLabel = cost >= 1e6 ? cost.toExponential(2) : cost.toLocaleString()
              return (
                <div key={i} className="rot-value-item">
                  #{i + 1}: {v.toFixed(2)}
                  <div style={{ marginTop: 6 }}>
                    <button
                      onClick={() => buyUpgrade(i)}
                      disabled={score < cost}
                      style={{ marginRight: 8 }}
                    >
                      Upgrade speed (level {level})
                    </button>
                    <small style={{ marginRight: 8 }}>cost: {costLabel}</small>
                    {level >= 100 && (
                      <button onClick={() => ascend(i)} style={{ marginLeft: 8 }}>
                        Ascend (reset level, double per-rotation increment)
                      </button>
                    )}
                    <div style={{ marginTop: 4 }}>
                      <small>Ascension multiplier: x{ascendMultipliers[i] || 1}</small>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

export default App
