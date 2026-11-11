import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {observer} from 'mobx-react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useVoiceCapture} from '../hooks/useVoiceCapture';
import {asrStore, modelStore} from '../store';
import {getEngine, SupertonicEngine} from '../services/tts';
import {buildPFML3, cleanTranslation, oppositeLanguage, type InterpreterLanguage} from '../services/interpreter/pfml3';
import {ROUTES} from '../utils/navigationConstants';

type Phase = 'idle' | 'translation' | 'speaking';
const colors = {background:'#F6F7FB',white:'#FFFFFF',text:'#182232',muted:'#64748B',ko:'#2861D7',ja:'#15816A',border:'#E5E9F0'};
export const InterpreterScreen: React.FC<{navigation?:any}> = observer(({navigation}) => {
  const insets = useSafeAreaInsets();
  const [direction,setDirection] = useState<InterpreterLanguage>('ko');
  const directionRef = useRef<InterpreterLanguage>('ko');
  const [phase,setPhase] = useState<Phase>('idle');
  const [original,setOriginal] = useState('');
  const [translated,setTranslated] = useState('');
  const [error,setError] = useState('');
  const [draft,setDraft] = useState('');
  const [textMode,setTextMode] = useState(false);
  const [duration,setDuration] = useState<number|null>(null);
  const [ttsReady,setTtsReady] = useState(false);
  const [ttsInstalling,setTtsInstalling] = useState(false);
  const [ttsProgress,setTtsProgress] = useState(0);
  const [ttsVoice,setTtsVoice] = useState<'F1'|'M1'>('F1');
  const ttsEngine = getEngine('supertonic') as SupertonicEngine;
  const mounted = useRef(true);
  const working = useRef(false);

  useEffect(() => {
    mounted.current = true;
    asrStore.setUserASROverride(true);
    asrStore.init().catch(console.warn);
    (getEngine('supertonic') as SupertonicEngine).isInstalled()
      .then(ready => {if(mounted.current)setTtsReady(ready);})
      .catch(console.warn);
    return () => {mounted.current=false;};
  }, []);

  const speak = useCallback(async (text:string, lang:InterpreterLanguage) => {
    const engine = getEngine('supertonic') as SupertonicEngine;
    if (!(await engine.isInstalled())) {
      throw new Error('AI 음성 모델 Supertonic 3를 설치해 주세요.');
    }
    const voices = await engine.getVoices();
    const voice = voices.find(v => v.id === ttsVoice);
    if (!voice) throw new Error('Supertonic 음성 스타일을 찾지 못했습니다.');
    await engine.play(text,voice,{language:lang,inferenceSteps:3});
  }, [ttsVoice]);

  const installTTS = useCallback(async () => {
    if (ttsInstalling || phase !== 'idle' || asrStore.captureState !== 'idle') return;
    setTtsInstalling(true);
    setTtsProgress(0);
    setError('');
    try {
      await (getEngine('supertonic') as SupertonicEngine).downloadModel(progress => {
        if (mounted.current) setTtsProgress(progress);
      });
      const installed = await (getEngine('supertonic') as SupertonicEngine).isInstalled();
      if (!installed) throw new Error('다운로드 후 모델 검증에 실패했습니다.');
      if (mounted.current) setTtsReady(true);
    } catch (e) {
      if (mounted.current) setError('Supertonic 3 설치 실패: '+String(e));
    } finally {
      if (mounted.current) setTtsInstalling(false);
    }
  }, [ttsInstalling, phase]);

  const translate = useCallback(async (text:string, source:InterpreterLanguage) => {
    if (working.current || !text.trim()) return;
    const context = modelStore.context;
    if (!context || !/plamo/i.test(modelStore.activeModel?.name ?? '')) {
      setError('모델 관리에서 PLaMo 3 Translate 0.8B GGUF를 불러오세요.');
      return;
    }
    working.current=true;
    setOriginal(text.trim());setTranslated('');setError('');setDuration(null);
    setPhase('translation');setDirection(source);
    try {
      const started=Date.now();
      const result=await context.completion({
        prompt:buildPFML3(text.trim(),source),
        temperature:0,
        n_predict:256,
        stop:['<|plamo:tag|>','<|plamo:bos|>'],
      });
      const output=cleanTranslation(result.text || result.content || '');
      if (!output) throw new Error('번역 결과가 비어 있습니다.');
      if (!mounted.current) return;
      setDuration(Date.now()-started);
      setTranslated(output);
      if (ttsReady) {
        setPhase('speaking');
        try {await speak(output,oppositeLanguage(source));}
        catch(e) {if(mounted.current)setError(e instanceof Error ? e.message : String(e));}
      } else if (mounted.current) {
        setError('번역은 완료됐습니다. 음성 출력을 사용하려면 위에서 Supertonic 3 모델을 설치하세요.');
      }
    } catch(e) {
      if(mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current=false;
      if(mounted.current)setPhase('idle');
    }
  },[speak,ttsReady]);

  const onTranscript=useCallback((text:string) => {
    translate(text,directionRef.current).catch(console.warn);
  },[translate]);
  const capture=useVoiceCapture({onTranscript});
  const captureState=asrStore.captureState;
  const recording=captureState==='recording'||captureState==='requesting_perm';
  const transcribing=captureState==='transcribing';
  const busy=phase!=='idle'||transcribing;
  const modelReady=!!modelStore.context && /plamo/i.test(modelStore.activeModel?.name??'');
  const asrReady=asrStore.isSelectedTierReady;
  const downloading=asrStore.downloadStates.base==='downloading';
  const status=transcribing?'음성 인식 중...':phase==='translation'?'번역 중...':
    phase==='speaking'?'음성 재생 중...':recording?'녹음 중 · 다시 누르면 완료':'언어를 선택하고 말해 주세요';

  const pressMic=(lang:InterpreterLanguage)=>{
    if(recording){if(directionRef.current===lang)capture.stop();return;}
    if(busy||!modelReady||!asrReady)return;
    directionRef.current=lang;setDirection(lang);
    setError('');setOriginal('');setTranslated('');
    asrStore.setSpokenLanguage(lang);
    (getEngine('supertonic') as SupertonicEngine).stop().catch(()=>{});
    capture.start();
  };
  const replay=()=>{
    if(!translated||phase!=='idle')return;
    setPhase('speaking');setError('');
    speak(translated,oppositeLanguage(direction))
      .catch(e=>setError(String(e))).finally(()=>{if(mounted.current)setPhase('idle');});
  };

  return <View style={styles.root}><ScrollView contentContainerStyle={[styles.content,{paddingTop:insets.top+18}]} keyboardShouldPersistTaps="handled">
    <View style={styles.header}>
      <View style={{flex:1}}>
        <Text style={styles.eyebrow}>OFFLINE INTERPRETER</Text>
        <Text style={styles.title}>PLaMo Voice</Text>
        <Text style={styles.muted}>한국어 ↔ 日本語</Text>
      </View>
      <Pressable onPress={()=>navigation.navigate(ROUTES.MODELS)} style={styles.smallButton}><Text style={styles.smallButtonText}>모델 관리</Text></Pressable>
    </View>
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>엔진 상태</Text>
      <Text style={styles.muted}>PLaMo 0.8B: {modelReady?'준비됨':'모델을 불러오세요'}</Text>
      <Text style={styles.muted}>Whisper: {asrReady?'준비됨':'설치 필요'}</Text>
      <Text style={styles.muted}>Supertonic 3 AI 음성: {ttsReady?'준비됨':ttsInstalling?'설치 중':'설치 필요'}</Text>
      {!ttsReady && <Pressable disabled={ttsInstalling || busy || recording} style={[styles.install,(ttsInstalling||busy||recording)&&styles.disabled]}
        onPress={installTTS}>
        <Text style={styles.installText}>{ttsInstalling
          ? 'AI 음성 다운로드 '+Math.round(ttsProgress*100)+'%'
          : 'Supertonic 3 AI 음성 설치 · 약 400MB'}</Text>
      </Pressable>}
      {ttsReady && <View style={styles.voiceOptions}>
        <Text style={styles.hint}>AI 음성 선택 (한국어·일본어 공통)</Text>
        <Pressable onPress={()=>setTtsVoice('F1')} style={[styles.voicePill,ttsVoice==='F1'&&styles.voicePillActive]}>
          <Text style={styles.voicePillText}>여성 F1</Text>
        </Pressable>
        <Pressable onPress={()=>setTtsVoice('M1')} style={[styles.voicePill,ttsVoice==='M1'&&styles.voicePillActive]}>
          <Text style={styles.voicePillText}>남성 M1</Text>
        </Pressable>
      </View>}
      {!asrReady&&<Pressable disabled={downloading} style={[styles.install,downloading&&styles.disabled]}
        onPress={()=>asrStore.downloadModel('base').catch(e=>setError(String(e)))}>
        <Text style={styles.installText}>{downloading?('다운로드 중 '+Math.round(asrStore.downloadProgress.base*100)+'%'):'Whisper Base 설치 · 약 82MB'}</Text>
      </Pressable>}
      <Text style={styles.hint}>모델은 Wi-Fi로 설치 권장 · 설치 후 음성 인식·번역·출력 모두 오프라인</Text>
    </View>
    <View style={styles.status}>{(busy||recording)&&<ActivityIndicator color={colors.ko}/>}<Text style={styles.muted}>{status}</Text></View>
    <View style={styles.buttons}>
      {(['ko','ja'] as InterpreterLanguage[]).map(lang=>{
        const active=recording&&directionRef.current===lang;
        const disabled=busy||(!recording&&(!modelReady||!asrReady))||(recording&&!active);
        return <Pressable key={lang} disabled={disabled} onPress={()=>pressMic(lang)}
          style={[styles.mic,{backgroundColor:lang==='ko'?colors.ko:colors.ja},disabled&&styles.disabled]}
          accessibilityRole="button" accessibilityLabel={lang==='ko'?'한국어 말하기':'일본어 말하기'}>
          <Text style={styles.micIcon}>{active?'■':'●'}</Text>
          <Text style={styles.micText}>{lang==='ko'?'한국어 말하기':'日本語で話す'}</Text>
          <Text style={styles.micHint}>{active?'다시 눌러 녹음 완료':lang==='ko'?'한국어 → 일본어':'日本語 → 한국어'}</Text>
        </Pressable>;
      })}
    </View>
    <View style={styles.panel}>
      <Text style={styles.caption}>인식한 원문</Text>
      <Text selectable style={styles.original}>{original||'말한 내용이 여기에 표시됩니다.'}</Text>
      <View style={styles.divider}/>
      <Text style={styles.caption}>번역 결과</Text>
      <Text selectable style={styles.translated}>{translated||'번역문이 여기에 표시됩니다.'}</Text>
      {duration!==null&&<Text style={styles.hint}>번역 { (duration/1000).toFixed(2)}초 · STT/TTS 제외</Text>}
      {!!translated&&<Pressable style={styles.replay} onPress={replay}><Text style={styles.replayText}>▶ 다시 듣기</Text></Pressable>}
    </View>
    {!!error&&<Text style={styles.error}>{error}</Text>}
    {captureState==='error'&&<Text style={styles.error}>음성 인식 오류: {String(asrStore.lastError)}</Text>}
    <Pressable style={styles.textToggle} onPress={()=>setTextMode(v=>!v)}><Text style={styles.muted}>{textMode?'텍스트 테스트 닫기':'텍스트 번역 테스트'}</Text></Pressable>
    {textMode&&<View style={styles.panel}>
      <TextInput multiline style={styles.input} value={draft} onChangeText={setDraft} placeholder="번역할 문장을 입력하세요"/>
      <Pressable style={styles.install} onPress={()=>translate(draft,direction)} disabled={busy||!modelReady}><Text style={styles.installText}>번역 + 음성 출력</Text></Pressable>
      <Pressable style={styles.textToggle} onPress={()=>setDirection(v=>v==='ko'?'ja':'ko')}><Text style={styles.muted}>번역 방향: {direction==='ko'?'한국어 → 일본어':'일본어 → 한국어'} (전환)</Text></Pressable>
    </View>}
    <Text style={styles.footer}>PocketPal 기반 · PLaMo Community License 적용</Text>
  </ScrollView></View>;
});

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:colors.background},
  content:{padding:20,paddingBottom:50},
  header:{flexDirection:'row',alignItems:'center',marginBottom:22},
  eyebrow:{fontSize:11,fontWeight:'800',color:colors.ko,letterSpacing:1.2},
  title:{fontSize:30,fontWeight:'800',color:colors.text,marginVertical:6},
  muted:{color:colors.muted,fontSize:13},
  panel:{backgroundColor:colors.white,padding:18,borderRadius:18,borderWidth:1,borderColor:colors.border},
  panelTitle:{fontSize:14,fontWeight:'800',color:colors.text,marginBottom:8},
  smallButton:{padding:12,backgroundColor:colors.white,borderRadius:12,borderColor:colors.border,borderWidth:1},
  smallButtonText:{color:colors.text,fontWeight:'700'},
  install:{backgroundColor:colors.ko,padding:13,marginTop:13,borderRadius:10,alignItems:'center'},
  installText:{color:colors.white,fontWeight:'700'},
  disabled:{opacity:.45},
  status:{minHeight:65,justifyContent:'center',alignItems:'center',flexDirection:'row',gap:12},
  buttons:{flexDirection:'row',gap:12,marginBottom:20},
  mic:{flex:1,padding:18,minHeight:170,borderRadius:20,justifyContent:'center',alignItems:'center'},
  micIcon:{fontSize:28,color:colors.white,marginBottom:10},
  micText:{fontSize:16,fontWeight:'800',color:colors.white,textAlign:'center'},
  micHint:{fontSize:11,color:'#EAF7FE',marginTop:8,textAlign:'center'},
  caption:{fontSize:12,fontWeight:'700',color:colors.muted},
  original:{fontSize:17,color:colors.text,marginTop:10,minHeight:32},
  translated:{fontSize:21,fontWeight:'700',color:colors.text,marginTop:12,minHeight:48},
  divider:{backgroundColor:colors.border,height:1,marginVertical:20},
  hint:{fontSize:11,color:colors.muted,marginTop:10},
  replay:{alignSelf:'flex-start',backgroundColor:'#E8F0FE',marginTop:12,padding:12,borderRadius:10},
  replayText:{fontWeight:'700',color:colors.ko},
  error:{color:'#B91C1C',padding:14,backgroundColor:'#FEF2F2',marginTop:10,borderRadius:10},
  textToggle:{padding:16,alignItems:'center'},
  input:{fontSize:16,backgroundColor:colors.white,color:colors.text,minHeight:90,textAlignVertical:'top'},
  footer:{textAlign:'center',fontSize:11,marginTop:12,color:colors.muted},
  voiceOptions:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8,marginTop:10},
  voicePill:{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:9},
  voicePillActive:{borderColor:colors.ko,backgroundColor:'#E8F0FE'},
  voicePillText:{fontSize:12,color:colors.text,fontWeight:'700'},
});