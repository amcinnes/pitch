import * as dsp from 'dsp.js'

document.addEventListener('DOMContentLoaded', () => {
	const W = 2048
	const MAX_TAU = W / 2

	const canvas = document.getElementById('canvas')
	const cx = canvas.getContext('2d')
	const ac = new AudioContext()

	const waveform = new Float32Array(W)
  const nsdf = new Float32Array(MAX_TAU)

  var period

	const spn = ac.createScriptProcessor(W, 1, 1)
	spn.onaudioprocess = (ape) => {
		// just copy input data to waveform
		// (this will be more useful later when we're doing overlapping windows or something)
		// TODO overlapping windows
		const inputData = ape.inputBuffer.getChannelData(0)
		for (var i = 0; i < W; i++) {
			waveform[i] = inputData[i]
		}
		calculate_nsdf(waveform, nsdf)
    // TODO get period out of that...

    // find maximum after the first negative zero crossing
    var foundFirstZero = false
    var max = 0
    for (var i = 0; i < MAX_TAU; i++) {
      if (nsdf[i] < 0) foundFirstZero = true
      if (foundFirstZero && nsdf[i] > max) {
        max = nsdf[i]
        period = i
      }
    }
    // TODO clarity filter
    // TODO find the first key maximum that is higher than k * overall maximum, and set that as the period
    // [not yet] parabolic interpolation
    // [not yet] convert number of samples to a note
    // [not yet] maintain a circular buffer that we can graph on the canvas
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

	function draw() {
		requestAnimationFrame(draw)
		cx.fillStyle = 'rgb(255, 255, 255)'
		cx.fillRect(0, 0, canvas.width, canvas.height)
		cx.strokeStyle = 'rgb(0, 0, 0)'
		cx.beginPath()
		for (var i = 0; i < MAX_TAU; i++) {
			const x = i / MAX_TAU * canvas.width
			const y = - nsdf[i] * (canvas.height / 2) + canvas.height / 2
			if (i == 0) {
				cx.moveTo(x, y)
			} else {
				cx.lineTo(x, y)
			}
		}
		cx.stroke()
		cx.beginPath()
    cx.moveTo(period / MAX_TAU * canvas.width, 0)
    cx.lineTo(period / MAX_TAU * canvas.width, canvas.height)
		cx.strokeStyle = 'rgb(255, 0, 0)'
    cx.stroke()
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
      nsdf[i] = r[i] / m[i]
    }
  }

})
