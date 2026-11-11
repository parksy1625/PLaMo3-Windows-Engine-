/** PLaMo 3 Translate direct-completion prompt (PFML3). */
export type InterpreterLanguage = 'ko' | 'ja';
export const oppositeLanguage = (source:InterpreterLanguage):InterpreterLanguage => source==='ko'?'ja':'ko';
export function buildPFML3(text:string,source:InterpreterLanguage):string {
  const value=text.trim();
  if(!value) throw new Error('번역할 문장이 비어 있습니다.');
  const target=oppositeLanguage(source);
  return '<|plamo:tag|>dataset<|plamo:msg|>translation'
    + '<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>'+source+'<|plamo:msg|>'+value
    + '<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>'+target
    + (target==='ja'?'<|plamo:key|>form<|plamo:val|>polite':'')
    + '<|plamo:msg|>';
}
export function cleanTranslation(raw:string):string {
  return raw.split('<|plamo:tag|>',1)[0].split('<|plamo:bos|>',1)[0].trim();
}
