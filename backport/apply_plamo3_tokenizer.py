from pathlib import Path
import sys
legacy=Path(sys.argv[1]); donor=Path(sys.argv[2])
p=legacy/'src/llama-vocab.cpp'
old=p.read_text(encoding='utf-8')
new= (donor/'src/llama-vocab.cpp').read_text(encoding='utf-8')
start='struct llm_tokenizer_plamo2 : llm_tokenizer {'
end='struct llm_tokenizer_plamo2_session'
def segment(s):
 a=s.index(start);b=s.index(end,a)
 return a,b,s[a:b]
a,b,original=segment(old)
_,_,replacement=segment(new)
if 'pre_segment_' not in replacement: raise RuntimeError('Donor does not contain PLaMo3 pre-segmentation')
old=old[:a]+replacement+old[b:]
needle='case LLAMA_VOCAB_TYPE_PLAMO2:\n        case LLAMA_VOCAB_TYPE_PLAMO3:\n            tokenizer = std::make_unique<llm_tokenizer_plamo2>(vocab);'
if old.count(needle)!=1: raise RuntimeError('Expected existing minimal patch dispatch not found')
old=old.replace(needle,'case LLAMA_VOCAB_TYPE_PLAMO2:\n            tokenizer = std::make_unique<llm_tokenizer_plamo2>(vocab, false);\n            break;\n        case LLAMA_VOCAB_TYPE_PLAMO3:\n            tokenizer = std::make_unique<llm_tokenizer_plamo2>(vocab, true);')
p.write_text(old,encoding='utf-8')
print('Transplanted PLaMo tokenizer implementation with PLaMo3 pre-segmentation; verify Windows compile and GGUF load.')
