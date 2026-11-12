package com.pocketpal

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.sqrt

class SenseVoicePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(SenseVoiceModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

/** 16kHz mono microphone -> SenseVoice INT8 ONNX, entirely on Android. */
class SenseVoiceModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var inFlight = false
  @Volatile private var capturing = false
  private var recognizer: OfflineRecognizer? = null
  private var loadedLanguage = ""

  override fun getName(): String = "SenseVoiceModule"

  // Required by RN NativeEventEmitter compatibility.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun emit(resultText: String, elapsedMs: Long, error: String = "") {
    if (!ctx.hasActiveReactInstance()) return
    val data = Arguments.createMap().apply {
      putString("text", resultText)
      putDouble("decodeMs", elapsedMs.toDouble())
      putString("error", error)
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("SenseVoiceResult", data)
  }

  private fun describeError(e: Throwable): String {
    return generateSequence(e) { it.cause }.take(5).joinToString(" <- ") {
      it.javaClass.simpleName + ": " + (it.message ?: "no message")
    }
  }

  private fun loadNativeRuntime() {
    try {
      // A dedicated ONNX Runtime SONAME prevents clashes with RN ONNX Runtime.
      System.loadLibrary("onnxruntime_sherpa")
      System.loadLibrary("sherpa-onnx-jni")
    } catch (e: Throwable) {
      throw IllegalStateException("SenseVoice native libraries failed: " + describeError(e), e)
    }
  }

  private fun recognizerFor(lang: String, modelPath: String, tokensPath: String): OfflineRecognizer {
    if (recognizer != null && loadedLanguage == lang) return recognizer!!
    recognizer?.release()
    recognizer = null
    val model = File(modelPath)
    val tokens = File(tokensPath)
    require(model.isFile && model.length() > 200_000_000L) { "SenseVoice model missing or incomplete" }
    require(tokens.isFile && tokens.length() > 100_000L) { "SenseVoice tokens missing" }
    val cfg = OfflineRecognizerConfig(
      modelConfig = OfflineModelConfig(
        senseVoice = OfflineSenseVoiceModelConfig(
          model = model.absolutePath,
          language = lang,
          useInverseTextNormalization = true
        ),
        tokens = tokens.absolutePath,
        numThreads = 4,
        provider = "cpu",
        modelType = "sense_voice"
      )
    )
    val next = OfflineRecognizer(config = cfg)
    recognizer = next
    loadedLanguage = lang
    return next
  }

  @ReactMethod
  fun start(language: String, modelPath: String, tokensPath: String, promise: Promise) {
    if (language != "ko" && language != "ja") {
      promise.reject("LANG", "Only ko/ja are supported")
      return
    }
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission required")
      return
    }
    synchronized(this) {
      if (inFlight) {
        promise.reject("BUSY", "SenseVoice is still recording or decoding")
        return
      }
      inFlight = true
      capturing = true
    }
    executor.execute {
      var started = false
      var mic: AudioRecord? = null
      try {
        loadNativeRuntime()
        val engine = recognizerFor(language, modelPath, tokensPath)
        val bufferSize = maxOf(
          AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT),
          6400
        )
        require(bufferSize > 0) { "Invalid microphone buffer size" }
        mic = AudioRecord(
          MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize
        )
        check(mic.state == AudioRecord.STATE_INITIALIZED) { "Microphone initialization failed" }
        mic.startRecording()
        started = true
        promise.resolve(true)
        val fragments = ArrayList<FloatArray>()
        var total = 0
        var heardSpeech = false
        val startMs = SystemClock.elapsedRealtime()
        var lastVoicedMs = startMs
        val audioBuffer = ShortArray(800) // 50ms chunks
        while (capturing && SystemClock.elapsedRealtime() - startMs < 20000L) {
          val n = mic.read(audioBuffer, 0, audioBuffer.size)
          if (n < 0) throw IllegalStateException("AudioRecord.read() = $n")
          if (n == 0) continue
          val fragment = FloatArray(n)
          var energy = 0.0
          for (i in 0 until n) {
            val value = audioBuffer[i] / 32768.0f
            fragment[i] = value
            energy += value * value
          }
          fragments.add(fragment)
          total += n
          val rms = sqrt(energy / n)
          if (rms >= 0.012) {
            heardSpeech = true
            lastVoicedMs = SystemClock.elapsedRealtime()
          }
          // Once speech is heard, end the utterance after ~1.0s quiet.
          if (heardSpeech && total >= 16000 &&
            SystemClock.elapsedRealtime() - lastVoicedMs > 1000L) break
        }
        capturing = false
        mic.stop()
        mic.release()
        mic = null
        if (total < 4800 || !heardSpeech) {
          emit("", 0, "음성이 감지되지 않았습니다. 다시 말해 주세요.")
        } else {
          val audio = FloatArray(total)
          var at = 0
          for (part in fragments) {
            System.arraycopy(part, 0, audio, at, part.size)
            at += part.size
          }
          val decodeStart = SystemClock.elapsedRealtime()
          val stream = engine.createStream()
          try {
            stream.acceptWaveform(audio, 16000)
            engine.decode(stream)
            val text = engine.getResult(stream).text.trim()
            val decodedMs = SystemClock.elapsedRealtime() - decodeStart
            emit(text, decodedMs, if (text.isEmpty()) "인식 결과가 비어 있습니다." else "")
          } finally {
            stream.release()
          }
        }
      } catch (e: Throwable) {
        val detail = describeError(e)
        android.util.Log.e("SenseVoiceModule", "Native ASR failure: " + detail, e)
        if (!started) promise.reject("SENSEVOICE_START", detail, e)
        else emit("", 0, detail)
      } finally {
        try {mic?.stop()} catch (_: Throwable) {}
        try {mic?.release()} catch (_: Throwable) {}
        capturing = false
        inFlight = false
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    capturing = false
    promise.resolve(true)
  }

  override fun invalidate() {
    capturing = false
    executor.execute {
      recognizer?.release()
      recognizer = null
      loadedLanguage = ""
    }
    super.invalidate()
  }
}
