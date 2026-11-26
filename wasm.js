/** @type {WebAssembly.Instance} */
let instance = {}
let module = {}

let webglObjs = []
webglObjs.push(null)

let sockets = []
let sockID = 0

const text_atlas = new OffscreenCanvas(1024, 1024);
const text_ctx = text_atlas.getContext('2d');

class VImage {
	constructor() {
		this.bitmap = null
		this.canvas = null
		this.ctx = null
	}
	async decodePng(rawArray) {
		const blob = new Blob([rawArray], {type: 'image/png'} )
		this.bitmap = await createImageBitmap(blob)

		this.canvas = new OffscreenCanvas(this.bitmap.width, this.bitmap.height)
		this.ctx = this.canvas.getContext('2d');
		this.ctx.drawImage(this.bitmap, 0, 0)
	}
	free() {
		this.bitmap.close()
	}
	upload_texture() {
		return upload_texture_from_canvas(this.ctx, 0, 0, this.bitmap.width, this.bitmap.height)
	}
}

class VFile {
	constructor(fetchPath, virtualPath) {
		this.name = virtualPath
		this.error = null
		this.data = null
		this.img  = null
		this.ready = (async () => {
			try {
				const r = await fetch(fetchPath)
				if (!r.ok) throw new Error(`${r.status} ${fetchPath}`)
				const buf = await r.arrayBuffer()
				this.data = new Uint8Array(buf)
				if (fetchPath.endsWith('.png')) {
					this.img = new VImage()
					await this.img.decodePng(this.data)
				}
			} catch (e) {
				this.error = e
			}
		})()
	}

	hasError() {
		return this.error != null
	}

	close() {
		if (this.img != null) {
			this.img.free()
		}
	}
}

class FS {
	constructor() {
		/** @type {VFile[]} */
		this.files = []
	}
	async fetchFile(name, fetchPath) {
		const vfile = new VFile(fetchPath, name)
		await vfile.ready
		if (vfile.error) throw vfile.error
		this.files.push(vfile)
	}
	open(name) {
		for (const [fd, file] of this.files.entries()) {
			if (file.name == name) {
				if (file.hasError())
					return -1
				return fd
			}
		}
		return -1
	}
	verifyFD(fd) {
		if (fd < 0)
			return false
		return fd < this.files.length
	}
	read(fd) {
		if (!this.verifyFD(fd))
			return new Uint8Array([])
		if (this.files[fd].data == null)
			return new Uint8Array([])
		return this.files[fd].data
	}
	get_fsize(fd) {
		if (!this.verifyFD(fd))
			return 0
		if (this.files[fd].data == null)
			return 0
		return this.files[fd].data.length
	}
	upload_texture(fd) {
		if (!this.verifyFD(fd))
			return 0
		if (this.files[fd].img == null)
			return 0
		return this.files[fd].img.upload_texture()
	}
	get_width(fd) {
		if (!this.verifyFD(fd))
			return 0
		if (this.files[fd].img == null)
			return 0
		return this.files[fd].img.bitmap.width
	}
	get_height(fd) {
		if (!this.verifyFD(fd))
			return 0
		if (this.files[fd].img == null)
			return 0
		return this.files[fd].img.bitmap.height
	}
}

function findSocket(id) {
	for (const sock of sockets) {
		if (sock.id == id) {
			return sock
		}
	}
	return null
}

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('canvas')
/** @type {WebGLRenderingContext} */
let gl = canvas.getContext("webgl2", {
	alpha: true,
	antialias: true
});
if (gl == null) {
	console.log("Failed to create OpenGL context.")
	throw new Error("Init Failed!");
}
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

let uniforms = new Map();

function getUniformLocation(program, name) {
	if (!uniforms.has(program)) {
		uniforms.set(program, new Map())
	}
	if (!uniforms.get(program).has(name)) {
		const found = gl.getUniformLocation(program, name);
		if (found == null)
			return 0;
		uniforms.get(program).set(name, webglObj(found))
	}
	return uniforms.get(program).get(name);
}


function wasm_log_number(ptr, len, num) {
	const str_array = new Uint8Array(instance.exports.memory.buffer, ptr, len)
	const decoder = new TextDecoder()
	const str = decoder.decode(str_array)
	console.log(str, num)
}

function wasm_log_floats(ptr, len, f1, f2) {
	const str_array = new Uint8Array(instance.exports.memory.buffer, ptr, len)
	const decoder = new TextDecoder()
	const str = decoder.decode(str_array)
	console.log(str, f1.toFixed(2), f2.toFixed(2))
}

function wasm_logs(ptr, len) {
	const str_array = new Uint8Array(instance.exports.memory.buffer, ptr, len)
	const decoder = new TextDecoder()
	const str = decoder.decode(str_array)
	console.log(str)
}

function wasm_abort() {
	console.error("Error: reached wasm_abort()");
	throw new Error("Abort!");
}

function assertionFailed(file, file_len, line) {
	const str_array = new Uint8Array(instance.exports.memory.buffer, file, file_len)
	const decoder = new TextDecoder()
	const str = decoder.decode(str_array)
	console.error(str, ": ", line)
	throw new Error("Assertion Failed!");
}

function lengthBytesUTF8(str) {
	const bytes = new TextEncoder().encode(str);
	return bytes.length;
}

function utf8ToStringLen(ptr, len) {
	const mem = new Uint8Array(instance.exports.memory.buffer);
	let end = ptr + len;

	return new TextDecoder("utf-8").decode(mem.subarray(ptr, end));
}

function utf8ToString(ptr) {
	const mem = new Uint8Array(instance.exports.memory.buffer);
	let end = ptr;
	while (mem[end] !== 0) end++;

	return new TextDecoder("utf-8").decode(mem.subarray(ptr, end));
}

function toJS(ptr, len) {
	const mem = new Uint8Array(instance.exports.memory.buffer, ptr, len)
	return mem;
}

function toJS32(ptr, len) {
	const mem = new Uint32Array(instance.exports.memory.buffer, ptr, len)
	return mem;
}

function toJSF32(ptr, len) {
	const mem = new Float32Array(instance.exports.memory.buffer, ptr, len)
	return mem;
}

function stringToUTF8(str, ptr, maxBytes) {
	const bytes = new TextEncoder().encode(str);
	const mem = new Uint8Array(instance.exports.memory.buffer);

	const len = Math.min(bytes.length, maxBytes - 1);
	mem.set(bytes.subarray(0, len), ptr);
	mem[ptr + len] = 0;

	return len;
}

function webglObj(obj) {
	if (obj == null) {
		console.error("NULL object passed to webglObj()!")
		return -1
	}
	for (let index = 1; index < webglObjs.length; index++) {
		if (webglObjs[index] == null) {
			webglObjs[index] = obj;
			return index;
		}
	}

	const id = webglObjs.length;
	webglObjs.push(obj);
	return id;
}

function copyToWASM(jsArr, wasmPtr, numBytes) {
	if (!(jsArr instanceof Uint8Array)) {
		jsArr = new Uint8Array(jsArr)
	}
	const dst = new Uint8Array(instance.exports.memory.buffer, wasmPtr, numBytes)
	dst.set(jsArr.subarray(0, numBytes))
}

function copyFromWASM(wasmPtr, numBytes) {
	return new Uint8array(instance.exports.memory.buffer, wasmPtr, numBytes).slice()
}

function wasmView(wasmPtr, numBytes) {
	return new Uint8array(instance.exports.memory.buffer, wasmPtr, numBytes)
}

function upload_texture_from_canvas(ctx, x, y, width_, height_) {
	const { data, width, height } = ctx.getImageData(x, y, width_, height_);

	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.generateMipmap(gl.TEXTURE_2D);
	return webglObj(texture)
}

function load_img(cfname, callbackCtx) {
	let fname = utf8ToString(cfname);
	var img = new Image();
	img.src = fname;
	img.decode().then(() => {
		const canvas = new OffscreenCanvas(img.width, img.height);
		const ctx = canvas.getContext('2d');
		ctx.translate(0, img.height);
		ctx.scale(1, -1);
		ctx.drawImage(img, 0, 0);
		const texture = upload_texture_from_canvas(ctx, 0, 0, img.width, img.height);
		instance.exports.load_img_on_success(cfname, callbackCtx, texture, img.width, img.height);
	}).catch(err => {
		console.log(err);
		instance.exports.load_img_on_error(cfname, callbackCtx);
	})
}

let hiddenInput = null;
let keyboardGotOpen = false;
function ensureHiddenInput() {
	if (hiddenInput) return hiddenInput;
	hiddenInput = document.createElement('input');
	hiddenInput.id = "HiddenField";
	hiddenInput.style.position = 'fixed';
	hiddenInput.style.opacity = '0';
	hiddenInput.style.left = '-9999px'; // display:none does not work on a lot of Android and iOS phones
	document.body.appendChild(hiddenInput);

	hiddenInput.addEventListener('input', () => {
		const bytes = new TextEncoder().encode(hiddenInput.value);
		const ptr = instance.exports.malloc(bytes.length);
		copyToWASM(bytes, ptr, bytes.length)
		instance.exports.virtual_keyboard_input(ptr, bytes.length);
		instance.exports.free(ptr, bytes.length);
	});
	hiddenInput.addEventListener('blur', () => {
		hiddenInput.value = ''
		instance.exports.virtual_keyboard_on_close()
	});
	return hiddenInput;
}

const webFS = new FS()
async function init() {
	if (!gl) {
		alert("Couldn't get webgl context!");
		return;
	}

	/** @type {WebGLRenderingContext} */
	gl = WebGLDebugUtils.makeDebugContext(gl)

	const importObjects = {
		imports: {
			wasm_log_number,
			wasm_log_floats,
			wasm_logs,
			wasm_abort,
			assertionFailed,
			load_img,

			read_ms_f64: () => performance.now(),

			wasm_get_ms: () => performance.now(),

			open_file: function (namePtr, nameLen) {
				const name = utf8ToStringLen(namePtr, nameLen)
				return webFS.open(name)
			},

			exit: function (code) {
				console.log('Program exited:', code)
				throw new Error("Exit!")
			},

			get_fsize: (fd) => webFS.get_fsize(fd),
			read_file: function(fd) {
				const buf = webFS.read(fd)
				const ptr = instance.exports.malloc(buf.length)
				if (ptr == 0)
					return 0
				copyToWASM(buf, ptr, buf.length)
				return ptr
			},

			file_img_upload: (fd) => webFS.upload_texture(fd),
			file_get_width: (fd) => webFS.get_width(fd),
			file_get_height: (fd) => webFS.get_height(fd),

			load_font: function (fontNameCStr) {
				const fontName = utf8ToString(fontNameCStr)
				document.fonts.load('24px "Helvetica Neue", Helvetica, Arial, sans-serif')
					.then(v => {
						console.log("Loaded font:", document.fonts.check(fontName))
						console.log(v)
					})
					.catch(e => console.log('Failed to load font: ', e))
			},

			rasterize_glyph: function (codepoint, fontNameCStr, out) {
				const fontName = utf8ToString(fontNameCStr)
				text_ctx.font = `${fontName}`
				const str = String.fromCodePoint(codepoint)
				const m = text_ctx.measureText(str)
				const left = m.actualBoundingBoxLeft
				const ascent = m.actualBoundingBoxAscent
				const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 2
				const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 2
				text_ctx.clearRect(0, 0, 1024, 1024)
				text_ctx.fillStyle = '#fff'
				text_ctx.fillText(str, left + 1, ascent + 1)
				const texture = upload_texture_from_canvas(text_ctx, 0, 0, w, h)

				new Float32Array(instance.exports.memory.buffer, out, 5)
					.set([w, h, -left - 1, ascent + 1, m.width])
				return texture
			},

			resize_canvas: function (w, h) {

				const dpr = window.devicePixelRatio || 1;

				const width = Math.round(w * dpr);
				const height = Math.round(h * dpr);
				canvas.width = width;
				canvas.height = height;
				canvas.style.width = `${w}px`;
				canvas.style.height = `${h}px`;
				gl.viewport(0, 0, width, height)
			},

			get_dpr: () => window.devicePixelRatio || 1,

			random_seed64: () => {
				const a = new Uint32Array(2);
				crypto.getRandomValues(a);
				return (BigInt(a[0]) << 32n) | BigInt(a[1]);
			},
			//random: (max) => Math.random() * max,
			sqrt: (v) => Math.sqrt(v),
			pow: (b, p) => Math.pow(b, p),
			sin: (v) => Math.sin(v),
			cos: (v) => Math.cos(v),
			tan: (v) => Math.tan(v),
			acos: (v) => Math.acos(v),
			atan2: (x, y) => Math.atan2(x, y),
			ceil: (x) => Math.ceil(x),

			glClearColor: (r, g, b, a) => gl.clearColor(r, g, b, a),
			glClear: (mask) => gl.clear(mask),
			glScissor: (x, y, w, h) => gl.scissor(x, y, w, h),
			glLineWidth: (w) => gl.lineWidth(w),
			glViewport: (x, y, w, h) => gl.viewport(x, y, w, h),
			glClearDepthf: (d) => gl.clearDepthf(d),
			glClearStencil: (s) => gl.clearStencil(s),
			glColorMask: (r, g, b, a) => gl.colorMask(r, g, b, a),
			glCompileShader: (shader) => gl.compileShader(webglObjs[shader]),
			glCullFace: (mode) => gl.cullFace(mode),
			//glDeleteBuffers: (n, buffs) => gl.deleteBuffers(n, buffs),
			glDeleteFramebuffer: (fb) => {
				gl.deleteFramebuffer(fb)
				webglObjs[fb] = null
			},
			glDeleteProgram: (program) => {
				gl.deleteProgram(webglObjs[program]);
				webglObj[program] = null;
			},
			glDeleteShader: (shader) => {
				gl.deleteShader(webglObjs[shader]);
				webglObj[shader] = null;
			},
			glDeleteTexture: (tex) => {
				gl.deleteTexture(webglObjs[tex]);
				webglObj[tex] = null;
			},
			glDepthFunc: (fn) => gl.depthFunc(fn),
			glDepthMask: (flag) => gl.depthMask(flag),
			glDepthRangef: (n, f) => gl.depthRangef(n, f),
			glDetachShader: (p, s) => gl.detachShader(webglObjs[p], webglObjs[s]),
			glDisable: (cap) => gl.disable(cap),
			glDisableVertexAttribArray: (idx) => gl.disableVertexAttribArray(idx),
			glDrawArrays: (mode, first, count) => gl.drawArrays(mode, first, count),
			glDrawElements: (mode, count, type, indices) => gl.drawElements(mode, count, type, indices),
			glDrawElementsInstanced: (mode, count, type, offset, instanceCount) => gl.drawElementsInstanced(mode, count, type, offset, instanceCount),
			glEnable: (cap) => gl.enable(cap),
			glBlendFunc: (sf, df) => gl.blendFunc(sf, df),
			glEnableVertexAttribArray: (idx) => gl.enableVertexAttribArray(idx),
			glFinish: () => gl.finish(),
			glFlush: () => gl.flush(),

			glCreateVertexArray: () => webglObj(gl.createVertexArray()),
			glCreateBuffer: () => webglObj(gl.createBuffer()),
			glCreateTexture: () => webglObj(gl.createTexture()),
			glCreateFramebuffer: () => webglObj(gl.createFramebuffer()),
			glCreateRenderbuffer: () => webglObj(gl.createRenderbuffer()),

			glGetUniformLocation: (program, name) => {
				const s = utf8ToString(name)
				const loc = getUniformLocation(webglObjs[program], s)
				return loc
			},
			glUniform1i: (location, v0) => gl.uniform1i(webglObjs[location], v0),
			glUniform1f: (location, v0) => gl.uniform1f(webglObjs[location], v0),
			glUniform2f: (location, v0, v1) => gl.uniform2f(webglObjs[location], v0, v1),
			glUniform3f: (location, v0, v1, v2) => gl.uniform3f(webglObjs[location], v0, v1, v2),
			glUniform4f: (location, v0, v1, v2, v3) => gl.uniform4f(webglObjs[location], v0, v1, v2, v3),
			glUniformMatrix4fv: (location, count, transpose, value) => {
				const _ = count
				const arr = toJSF32(value, 16)
				gl.uniformMatrix4fv(webglObjs[location], transpose, arr)
			},
			glWebClearUniformBuffer: () => {
				uniforms = []
				uniforms.push(null)
			},

			glActiveTexture: (tex) => gl.activeTexture(tex),
			glAttachShader: function (p, s) {
				const program = webglObjs[p];
				const shader = webglObjs[s];
				gl.attachShader(program, shader);
			},
			//glBindAttribLocation: (p, i, n) => gl.bindAttribLocation(p, i, n),
			glBindBuffer: (t, b) => gl.bindBuffer(t, webglObjs[b]),
			glBindFramebuffer: (t, fb) => gl.bindFramebuffer(t, webglObjs[fb]),
			glBindRenderbuffer: (t, rb) => gl.bindRenderbuffer(t, webglObjs[rb]),
			glBindVertexArray: (array) => gl.bindVertexArray(webglObjs[array]),
			glBindTexture: (target, tex) => gl.bindTexture(target, webglObjs[tex]),

			glCheckFramebufferStatus: (t) => gl.checkFramebufferStatus(t),
			glFramebufferTexture2D: (t, at, text, tex, level) => gl.framebufferTexture2D(t, at, text, webglObjs[tex], level),
			glFramebufferRenderbuffer: (t, at, rbt, rb) => gl.framebufferRenderbuffer(t, at, rbt, webglObjs[rb]),
			glRenderbufferStorage: (t, inf, w, h) => gl.renderbufferStorage(t, inf, w, h),

			glBufferData: function (target, size, data, usage) {
				gl.bufferData(target, toJS(data, size), usage)
			},

			glGetBufferParameter: (target, param) => gl.getBufferParameter(target, param),
			glGetBufferSubData: (target, srcOffset, size, ptr) => {
				const mem = new Uint8Array(instance.exports.memory.buffer)
				gl.getBufferSubData(target, srcOffset, mem, ptr, size)
			},

			glGetError: () => gl.getError(),

			glTexImage2D: function (target, level, internalFormat, width, height, border, format, type, pixels) {
				let multiplier = 4;
				if (internalFormat == gl.RED)
					multiplier = 1;

				gl.texImage2D(target, level, internalFormat, width, height, border, format, type, toJS(pixels, width * height * multiplier));
			},

			glTexParameteri: (target, pname, param) => gl.texParameteri(target, pname, param),
			glGenerateMipmap: (target) => gl.generateMipmap(target),

			glBufferSubData: (t, o, s, d) => {
				gl.bufferSubData(t, o, toJS(d, s));
			},
			glVertexAttribPointer: (i, s, t, n, st, p) => gl.vertexAttribPointer(i, s, t, n, st, p),
			glVertexAttribDivisor: (idx, div) => gl.vertexAttribDivisor(idx, div),

			glLinkProgram: (program) => gl.linkProgram(webglObjs[program]),
			glUseProgram: (program) => gl.useProgram(webglObjs[program]),


			glCreateShader: function (type) {
				const shader = gl.createShader(type);
				let id = webglObjs.length;
				webglObjs.push(shader);
				return id;
			},

			glCreateProgram: function () {
				const program = gl.createProgram();
				let id = webglObjs.length;
				webglObjs.push(program);
				return id;
			},

			glBindBufferBase: (target, index, buffer) => gl.bindBufferBase(target, index, webglObjs[buffer]),
			glGetUniformBlockIndex: function (program, blockNameCStr) {
				const blockName = utf8ToString(blockNameCStr)
				return gl.getUniformBlockIndex(webglObjs[program], blockName);
			},
			glUniformBlockBinding: (program, idx, binding) => gl.uniformBlockBinding(webglObjs[program], idx, binding),


			glWebGetProgramLinkStatus: function (program) {
				const obj = webglObjs[program];
				return gl.getProgramParameter(obj, gl.LINK_STATUS) ? 1 : 0;
			},

			glGetProgramInfoLog: function (program, maxlen, _, buf) {
				const obj = webglObjs[program];
				const str = gl.getProgramInfoLog(obj) || "";
				const bytes = lengthBytesUTF8(str);

				const writeLen = Math.min(bytes, maxlen - 1);
				stringToUTF8(str, buf, writeLen + 1);
			},

			glWebShaderSource: function (shader, src_ptr) {
				const src = utf8ToString(src_ptr);
				const shaderObj = webglObjs[shader];
				gl.shaderSource(shaderObj, src);
			},

			glWebGetShaderCompileStatus: function (shader) {
				const shaderObj = webglObjs[shader];
				return gl.getShaderParameter(shaderObj, gl.COMPILE_STATUS) ? 1 : 0;
			},

			glGetShaderInfoLog: function (shader, maxlen, _, buf) {
				const shaderObj = webglObjs[shader];
				const str = gl.getShaderInfoLog(shaderObj) || "";
				const bytes = lengthBytesUTF8(str);

				const writeLen = Math.min(bytes, maxlen - 1);
				stringToUTF8(str, buf, writeLen + 1);
			},

			ws_open: (url_c, cb) => {
				const url = utf8ToString(url_c)

				let sock = { s: new WebSocket(url), opened: false, id: sockID++ }
				sock.s.binaryType = "arraybuffer"
				sock.s.onopen = () => {
					sock.opened = true
					instance.exports.socket_on_open(sock.s.id, cb)
				}
				sock.s.onerror = e => {
					console.log("Websocket error: ", e)
					instance.exports.socket_on_error(sock.s.id, cb)
				}
				sock.s.onclose = () => instance.exports.socket_on_close(sock.id, cb)
				sock.s.onmessage = e => {
					const bytes = new Uint8Array(e.data)
					const ptr = instance.exports.malloc(bytes.length)

					copyToWASM(bytes, ptr, bytes.length)
					instance.exports.socket_on_message(sock.s.id, ptr, bytes.length, cb)

					instance.exports.free(ptr)
				}
				sockets.push(sock)
				return sock.sockID
			},
			ws_send: (id, ptr, len) => findSocket(id)?.s.send(toJS(ptr, len)),
			ws_close: id => findSocket(id)?.close(),
			http_get: (theUrl, callback, error_callback) => {
				const url = utf8ToString(theUrl)
				var xmlHttp = new XMLHttpRequest();
				xmlHttp.onreadystatechange = function () {
					if (xmlHttp.readyState == 4 && xmlHttp.status == 200) {
						const bytes = new Uint8Array(xmlHttp.responseText)
						const ptr = instance.exports.malloc(bytes.length)
						copyToWASM(bytes, ptr, bytes.length)
						callback(ptr, bytes.length)
					} else {
						error_callback()
					}
				}
				xmlHttp.open("GET", url, true) // true for asynchronous 
				xmlHttp.send(null)
			},
			open_virtual_keyboard: (x, y, w, h) => {
				keyboardGotOpen = true
				let input = ensureHiddenInput();
				input.value = ''
				input.style.left = `${x}px`
				input.style.bottom = `${y}px`
				input.style.width = `${w}px`
				input.style.height = `${h}px`
				input.focus();
			},
			close_virtual_keyboard: () => {
				let input = ensureHiddenInput();
				input.blur()
				input.style.left = '-9999px'
				input.value = ''
			},
		}
	}

	const result = await WebAssembly.instantiateStreaming(
		fetch("./module.wasm"),
		importObjects
	);
	instance = result.instance;
	module = result.module;


	const toWait = []
	const loadCount = instance.exports.get_loadable_files_count()
	for (let i = 0; i < loadCount; ++i) {
		const namePtr = instance.exports.get_loadable_file(i, 0)
		const name = utf8ToString(namePtr)
		const fetchPtr = instance.exports.get_loadable_file(i, 1)
		const fetchPath = utf8ToString(fetchPtr)
		toWait.push(webFS.fetchFile(name, fetchPath))
	}

	await Promise.all(toWait)
	

	const userPtr = instance.exports.entry(canvas.clientWidth, canvas.clientHeight);
	if (userPtr == 0) {
		alert("Failed to initialize program!");
		return;
	}

	document.addEventListener('keydown', e => instance.exports.on_key_down(e.keyCode))
	document.addEventListener('keyup', e => instance.exports.on_key_up(e.keyCode))
	document.addEventListener('mousemove', e => {
		const rect = canvas.getBoundingClientRect()
		const x = e.clientX - rect.x
		const y = e.clientY - rect.y
		if (x < 0 || y < 0 || x > rect.width || y > rect.height)
			return;

		instance.exports.on_mouse_move(x, y, e.movementX, e.movementY)
	})
	document.addEventListener('click', _ => {
		instance.exports.on_mouse_click()
	})
	document.addEventListener('mousedown', e => {
		instance.exports.on_mouse_down()
		if (keyboardGotOpen)
			e.preventDefault()
		keyboardGotOpen = false
	}, { passive: false })
	document.addEventListener('mouseup', _ => {
		instance.exports.on_mouse_up()
	})
	/*
			document.addEventListener('touchstart', e => {
				const rect = canvas.getBoundingClientRect()
				const touch = e.touches[0]
				const x = touch.clientX - rect.x
				const y = touch.clientX - rect.y
				if(x < 0 || y < 0 || x > rect.width || y > rect.height)
					return;
				instance.exports.on_mouse_move(x, y, 0, 0)
				instance.exports.on_mouse_down()
			})
			*/
	document.addEventListener('touchend', e => {
		const rect = canvas.getBoundingClientRect()
		const touch = e.changedTouches[0]
		const x = touch.clientX - rect.x
		const y = touch.clientY - rect.y
		if (x < 0 || y < 0 || x > rect.width || y > rect.height)
			return;
		e.preventDefault()
		instance.exports.on_mouse_move(x, y, 0, 0)
		instance.exports.on_mouse_down()
		instance.exports.on_mouse_up()
	}, { passive: false })
	window.addEventListener('wheel', e => {
		e.preventDefault();
		instance.exports.on_scroll(e.deltaY);
	},
		{ passive: false }
	);

	function on_resize() {
		instance.exports.on_resize(userPtr, window.innerWidth, window.innerHeight)
	}

	window.addEventListener("resize", (w, h) => on_resize(userPtr, w, h));
	//document.addEventListener("fullscreenchange", on_resize);

	let lastTime = performance.now();
	function loop(currentTime) {
		const dt = currentTime - lastTime
		lastTime = currentTime

		instance.exports.update(userPtr, dt / 1000);

		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

}

window.scriptAPI = {
	getScriptState: () => instance.exports.get_script_state(),
	joinLobby: (name, code) => {
		const nameLen = lengthBytesUTF8(name) + 1
		const codeLen = lengthBytesUTF8(code) + 1
		const nameP = instance.exports.malloc(nameLen)
		const codeP = instance.exports.malloc(codeLen)

		stringToUTF8(name, nameP, nameLen)
		stringToUTF8(code, codeP, codeLen)

		instance.exports.join_lobby(nameP, nameLen-1, codeP, codeLen-1)

		instance.exports.free(nameP)
		instance.exports.free(codeP)
	},
	getLobbyCode: () => {
		if (instance.exports.get_lobby_code) {
			let buf = instance.exports.malloc(16)
			const len = instance.exports.get_lobby_code(buf)
			if (len == 0) {
				instance.exports.free(buf)
				return ""
			}
			const s = utf8ToString(buf)
			instance.exports.free(buf)
			return s
		}
		return ""
	},
	executeAction: (n) => {
		instance.exports.execute_action(n)
	},
	getOptions: () => {
		let options = []
		const option_count = instance.exports.get_option_count()
		for (let index = 0; index < option_count; index++) {
			const len = instance.exports.get_option(index, null)
			const buf = instance.exports.malloc(len+1)

			instance.exports.get_option(index, buf)
			const s = utf8ToString(buf)
			options.push(s)

			instance.exports.free(buf)
		}
		return options
	},
	getPickCount: () => {
		return instance.exports.get_pick_count()
	},
	pickOptions: (options) => {
		const ptrs = []
		console.log("Options:", options)
		options.forEach(element => {
			const len = lengthBytesUTF8(element) + 1
			const ptr = instance.exports.malloc(len)
			console.log("adding:", element)
			stringToUTF8(element, ptr, len)
			instance.exports.add_pick_option(ptr, len-1)
			ptrs.push(ptr)
		});
		instance.exports.send_pick_options()
		ptrs.forEach(p => instance.exports.free(p))
	},
	pickButton: (n) => {
		instance.exports.pick_button(n)
	},
}

init();
