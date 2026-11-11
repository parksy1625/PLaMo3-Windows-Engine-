import {NativeModules} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

export type SenseLanguage = 'ko' | 'ja';
export const SENSEVOICE_DIR = RNFS.DocumentDirectoryPath + '/asr/sensevoice-2024';
const BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07';
const FILES = [
  {name:'model.int8.onnx',bytes:239233841},
  {name:'tokens.txt',bytes:315894},
] as const;

export function senseVoicePaths() {
  return {
    model: SENSEVOICE_DIR + '/model.int8.onnx',
    tokens: SENSEVOICE_DIR + '/tokens.txt',
  };
}

async function validFile(name:string, bytes:number):Promise<boolean> {
  const path=SENSEVOICE_DIR+'/'+name;
  try {
    if (!await RNFS.exists(path))return false;
    const stat=await RNFS.stat(path);
    return Number(stat.size)===bytes;
  }catch{return false;}
}

export async function senseVoiceInstalled():Promise<boolean> {
  return (await Promise.all(FILES.map(f=>validFile(f.name,f.bytes)))).every(Boolean);
}

export async function downloadSenseVoice(onProgress:(fraction:number)=>void):Promise<void> {
  await RNFS.mkdir(SENSEVOICE_DIR);
  const total=FILES.reduce((sum,f)=>sum+f.bytes,0);
  let completed=0;
  for (const file of FILES) {
    if (await validFile(file.name,file.bytes)) {
      completed+=file.bytes; onProgress(completed/total);continue;
    }
    const dst=SENSEVOICE_DIR+'/'+file.name;
    const tmp=dst+'.download';
    if(await RNFS.exists(tmp)) await RNFS.unlink(tmp);
    try {
      const result=await RNFS.downloadFile({
        fromUrl:BASE+'/'+file.name+'?download=true',
        toFile:tmp,
        background:false,
        progressInterval:350,
        progress:({bytesWritten}) => onProgress(Math.min(0.99,(completed+Math.min(file.bytes,bytesWritten))/total)),
      }).promise;
      if(result.statusCode!==200)throw new Error('HTTP '+result.statusCode+' '+file.name);
      const s=await RNFS.stat(tmp);
      if(Number(s.size)!==file.bytes)throw new Error(file.name+' size mismatch '+s.size);
      if(await RNFS.exists(dst))await RNFS.unlink(dst);
      await RNFS.moveFile(tmp,dst);
      completed+=file.bytes;onProgress(completed/total);
    }catch(e){
      if(await RNFS.exists(tmp))await RNFS.unlink(tmp);
      throw e;
    }
  }
  if(!await senseVoiceInstalled())throw new Error('SenseVoice model verification failed');
}

export interface SenseVoiceEvent {text:string;decodeMs:number;error:string;}
export interface SenseVoiceNative {
  start(language:SenseLanguage, modelPath:string,tokensPath:string):Promise<boolean>;
  stop():Promise<boolean>;
}
export const nativeSenseVoice:SenseVoiceNative=NativeModules.SenseVoiceModule;
