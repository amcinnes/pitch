import * as dsp from 'dsp.js'

document.addEventListener('DOMContentLoaded', () => {
  const W = 2048
  const MAX_TAU = W / 2

  const canvas = document.getElementById('canvas')
  const cx = canvas.getContext('2d')
  const ac = new AudioContext()

  const waveform = new Float32Array(W)
  const nsdf = new Float32Array(MAX_TAU)

  const PITCH_BUFFER_FRAMES = 400
  const pitch_buffer = new Float32Array(PITCH_BUFFER_FRAMES)
  const clarity_buffer = new Float32Array(PITCH_BUFFER_FRAMES)

  const spn = ac.createScriptProcessor(0, 1, 1)
  const inputBuffer = new Float32Array(W + spn.bufferSize)
  var inputBufferAmount = 0

  const WINDOW_SHIFT_AMOUNT = 512 // must be less than W

  const MIN_NOTE = 37.5 // just below D2
  const MAX_NOTE = 72.5 // just above C5

  spn.onaudioprocess = (ape) => {
    // Append new data onto inputBuffer and increment inputBufferAmount
    const inputData = ape.inputBuffer.getChannelData(0)
    for (var i = 0; i < inputData.length; i++) {
      inputBuffer[inputBufferAmount + i] = inputData[i]
    }
    inputBufferAmount += inputData.length

    while (inputBufferAmount >= W) {
      // process that data
      for (var i = 0; i < W; i++) {
        waveform[i] = inputBuffer[i]
      }
      const result = get_pitch(waveform, ape.inputBuffer.sampleRate)
      // Shift buffers along
      // We could be efficient and use circular buffers, but it isn't needed
      for (var i = 0; i < PITCH_BUFFER_FRAMES - 1; i++) {
        pitch_buffer[i] = pitch_buffer[i+1]
        clarity_buffer[i] = clarity_buffer[i+1]
      }
      pitch_buffer[PITCH_BUFFER_FRAMES - 1] = result.note
      clarity_buffer[PITCH_BUFFER_FRAMES - 1] = result.clarity

      // remove it from inputBuffer and decrement inputBufferAmount by W
      inputBufferAmount -= WINDOW_SHIFT_AMOUNT
      for (var i = 0; i < inputBufferAmount; i++) {
        inputBuffer[i] = inputBuffer[i + WINDOW_SHIFT_AMOUNT]
      }
    }
  }

  window.addEventListener('resize', resize)

  resize()

  navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
    const msasn = ac.createMediaStreamSource(stream)
    msasn.connect(spn)
    // ScriptProcessorNode doesn't work in Chrome if not connected to destination
    // https://bugs.chromium.org/p/chromium/issues/detail?id=327649
    spn.connect(ac.destination)

    draw()
  })

  function resize() {
    canvas.width = canvas.scrollWidth
    canvas.height = canvas.scrollHeight
  }

  function note_name(note_number) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    return names[note_number % 12] + (Math.floor(note_number / 12) - 1)
  }

  function draw() {
    requestAnimationFrame(draw)
    // Clear
    cx.fillStyle = 'rgb(255, 255, 255)'
    cx.fillRect(0, 0, canvas.width, canvas.height)
    // Border
    cx.strokeStyle = 'rgb(0, 0, 0)'
    cx.beginPath()
    cx.moveTo(0, canvas.height/4)
    cx.lineTo(canvas.width, canvas.height/4)
    cx.stroke()
    // In the top 1/4 of the canvas, draw the NSDF
    cx.strokeStyle = 'rgb(0, 0, 0)'
    cx.beginPath()
    for (var i = 0; i < MAX_TAU; i++) {
      const x = i / MAX_TAU * canvas.width
      const y = - nsdf[i] * (canvas.height / 8) + canvas.height / 8
      if (i == 0) {
        cx.moveTo(x, y)
      } else {
        cx.lineTo(x, y)
      }
    }
    cx.stroke()
    cx.strokeStyle = 'rgb(192, 192, 192)'
    cx.fillStyle = 'rgb(0, 0, 0)'
    cx.font = '16px sans-serif'
    for (var i = Math.floor(MIN_NOTE); i < MAX_NOTE; i++) {
      // Draw a line dividing this note from the next
      const x = (i + 0.5 - MIN_NOTE) / (MAX_NOTE - MIN_NOTE) * canvas.width
      cx.beginPath()
      cx.moveTo(x, canvas.height / 4)
      cx.lineTo(x, canvas.height)
      cx.stroke()
      // Labels
      const measured = cx.measureText(note_name(i))
      const textX = (i - MIN_NOTE) / (MAX_NOTE - MIN_NOTE) * canvas.width
      cx.fillText(note_name(i), textX - measured.width / 2, canvas.height - 20)
    }
    // In the lower 3/4 of the canvas, draw the pitch graph
    cx.beginPath()
    for (var i = 0; i < PITCH_BUFFER_FRAMES; i++) {
      const x = (pitch_buffer[i] - MIN_NOTE) / (MAX_NOTE - MIN_NOTE) * canvas.width
      const y = i / PITCH_BUFFER_FRAMES * (3*canvas.height/4) + canvas.height/4
      const y2 = (i + 1) / PITCH_BUFFER_FRAMES * (3*canvas.height/4) + canvas.height/4
      if (clarity_buffer[i] > 0.7) {
        cx.beginPath()
        cx.moveTo(x, y)
        cx.lineTo(x, y2)
        cx.strokeStyle = 'rgba(255, 0, 0, ' + (clarity_buffer[i] - 0.7) / 0.3 + ')'
        cx.stroke()
      }
    }
  }

  // Begin pitch detection algorithm code

  const cumulative_squares = new Float32Array(W + 1)

  // Given a block of waveform data of size W, calculate m(tau), for each tau from 0 to MAX_TAU - 1
  function calculate_m(waveform, m) {
    // cumulative_squares[i] = sum of x^2 for x in waveform[0] to waveform[i - 1] inclusive
    cumulative_squares[0] = 0
    for (var i = 1; i <= W; i++) {
      cumulative_squares[i] = cumulative_squares[i - 1] + waveform[i - 1] * waveform[i - 1]
    }
    // m[i] = sum of x^2 for x in waveform[0] to waveform[W - i - 1], plus sum of x^2 for x in waveform[i] to waveform[W - 1]
    for (var i = 0; i < MAX_TAU; i++) {
      m[i] = cumulative_squares[W - i] + cumulative_squares[W] - cumulative_squares[i]
    }
  }

  const fft = new dsp.FFT(W * 2)
  const fft_input = new Float32Array(W * 2)
  const imag = new Float32Array(W * 2) // just zeros
  const real = new Float32Array(W * 2)

  function calculate_r(waveform, r) {
    for (var i = 0; i < W; i++) {
      fft_input[i] = waveform[i]
    }
    fft.forward(fft_input)
    for (var i = 0; i < W * 2; i++) {
      real[i] = fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i]
    }
    const result = fft.inverse(real, imag)
    for (var i = 0; i < MAX_TAU; i++) {
      r[i] = result[i]
    }
  }

  const m = new Float32Array(MAX_TAU)
  const r = new Float32Array(MAX_TAU)

  function calculate_nsdf(waveform, nsdf) {
    calculate_m(waveform, m)
    calculate_r(waveform, r)
    for (var i = 0; i < MAX_TAU; i++) {
      nsdf[i] = 2 * r[i] / m[i]
    }
  }

  function parabolic_interpolation(i, ys) {
    const y0 = ys[i]
    const yl = ys[i-1]
    const yr = ys[i+1]

    const a = (yr + yl - 2 * y0) / 2
    const b = (yr - yl) / 2

    const x = -b / (2 * a)
    const y = a * x * x + b * x + y0
    return {x: x + i, y: y}
  }

  function calculate_maximum(nsdf) {
    // Find the first downwards zero crossing
    var firstNegative
    for (var i = 0; i < MAX_TAU; i++) {
      if (nsdf[i] < 0) {
        firstNegative = i
        break
      }
    }
    // find maximum after the first negative zero crossing
    var max = 0
    for (var i = firstNegative; i < MAX_TAU; i++) {
      if (nsdf[i] > max) {
        max = nsdf[i]
      }
    }
    // Find the first key maximum that is higher than k * overall maximum, and set that as the period
    const k = 0.8
    var keyMax = 0
    var period
    for (var i = firstNegative; i < MAX_TAU; i++) {
      // if we reach a zero crossing, going downwards, and it's after we've found the first zero,
      if (nsdf[i] < 0 && nsdf[i-1] >= 0) {
        // see what the previous maximum was. If it meets the condition, use it.
        if (keyMax > k * max) {
          break
        } else {
          // otherwise, reset the maximum to 0 and continue
          keyMax = 0
        }
      }
      if (nsdf[i] > keyMax) {
        keyMax = nsdf[i]
        period = i
      }
    }

    return period
  }

  function get_pitch(waveform, sampleRate) {
    calculate_nsdf(waveform, nsdf)
    const period = calculate_maximum(nsdf)
    const result = parabolic_interpolation(period, nsdf)
    const frequency = sampleRate / result.x
    const note = 12 * Math.log(frequency / 440) / Math.log(2) + 69
    return {note: note, clarity: result.y}
  }

})
