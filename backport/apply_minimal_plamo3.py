from pathlib import Path
import re,sys
root=Path(sys.argv[1])
def edit(path,fn):
 p=root/path; old=p.read_text(encoding='utf-8'); new=fn(old)
 if new==old: raise RuntimeError(f'No change: {path}')
 p.write_text(new,encoding='utf-8')
def once(s,old,new):
 if s.count(old)!=1: raise RuntimeError(f'Expected exactly one match for {old[:80]!r}, got {s.count(old)}')
 return s.replace(old,new,1)
def header(s):
 match=re.search(r'(?m)^(\s*LLAMA_VOCAB_TYPE_PLAMO2\s*=\s*6[^\n]*\n)',s)
 if not match: raise RuntimeError('PLAMO2 enum missing')
 return s[:match.end()]+ '        LLAMA_VOCAB_TYPE_PLAMO3 = 8, // PLaMo3 tokenizer\n'+s[match.end():]
edit('include/llama.h',header)
def vocab(s):
 s=once(s,'tokenizer_model == "plamo2"','(tokenizer_model == "plamo2" || tokenizer_model == "plamo3")')
 # only the assignment in the PLaMo2 metadata branch
 m=re.search(r'\} else if \(\(tokenizer_model == "plamo2" \|\| tokenizer_model == "plamo3"\)\) \{(?P<body>.*?)\n\s*\} else if',s,re.S)
 if not m: raise RuntimeError('Tokenizer model branch not found')
 body=m.group('body')
 body2=once(body,'type = LLAMA_VOCAB_TYPE_PLAMO2;', 'type = tokenizer_model == "plamo2" ? LLAMA_VOCAB_TYPE_PLAMO2 : LLAMA_VOCAB_TYPE_PLAMO3;')
 s=s[:m.start('body')]+body2+s[m.end('body'):]
 s=once(s,'case LLAMA_VOCAB_TYPE_PLAMO2: return "PLaMo2";','case LLAMA_VOCAB_TYPE_PLAMO2: return "PLaMo2";\n        case LLAMA_VOCAB_TYPE_PLAMO3: return "PLaMo3";')
 # PLaMo3 uses existing PLaMo2 tokenizer as a compatibility probe, NOT yet exact PLaMo3 segmentation.
 s=once(s,'case LLAMA_VOCAB_TYPE_PLAMO2:\n            tokenizer = std::make_unique<llm_tokenizer_plamo2>(vocab);','case LLAMA_VOCAB_TYPE_PLAMO2:\n        case LLAMA_VOCAB_TYPE_PLAMO3:\n            tokenizer = std::make_unique<llm_tokenizer_plamo2>(vocab);')
 # Avoid blanket switch-case insertion: it caused duplicate case labels.
 return s
edit('src/llama-vocab.cpp',vocab)
print('Minimal tokenizer recognition patch applied. Exact PLaMo3 segmentation not implemented.')
