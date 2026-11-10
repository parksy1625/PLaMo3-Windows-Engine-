# PLaMo3 Legacy Backport — experimental branch

## Known-good binary reference
User-supplied archive: LocalChatAI_V5_60_2_UI_SYNC_FIX_CLEAN.zip
Path inside archive: LocalChatAI_V5_60_2_GB6_RAG4_HG3_CLEAN/llama.cpp/llama-server.exe
BUILD_INFO.txt claims llama.cpp v0.4.0, MSVC v142 (19.29), AVX2/BMI2/FMA/F16C, static CRT requested.
**This is build metadata, not a verified upstream source commit.** Do not assume an upstream tag named v0.4.0 maps exactly to this executable.

## Backport gates
1. Identify exact upstream source commit corresponding to the legacy binary (build-info version alone insufficient).
2. Obtain source for both legacy revision and PLaMo3-capable revision; diff tokenizer and architecture implementations.
3. Port tokenizer metadata, pretokenizer, special-token rules, architecture mapping, tensor mapping, and inference graph dependencies as needed.
4. Build x64 MSVC with compatible CPU flags and validate all DLL dependencies.
5. Smoke-test `--version` and `--help` on build runner.
6. **Real model load test required** with plamo-3-translate-0.8b-Q4_K_M.gguf; no GGUF is stored in this repo.
7. Validate Korean/Japanese translation and crash behavior on Windows 10 LTSC 1809 and 21H2.
8. Only then replace the shipping engine and generate email-safe .zipp parts.

## Important
This branch is a research/isolation branch. It does not yet contain a functioning PLaMo3 backport.
A successful compilation alone is insufficient to establish model compatibility.
