#!/usr/bin/env python3
"""Overlay the interpreter UI onto a pinned upstream PocketPal v1.23 checkout."""
import sys, json, shutil
from pathlib import Path
base=Path(sys.argv[1]).resolve()
source=Path(__file__).resolve().parent/"src"
app=base/"App.tsx"
if not app.exists() or not (base/"src/store/ModelStore.ts").exists():
    raise SystemExit("PocketPal root not found")
text=app.read_text()
def replace(old,new,name):
    global text
    if text.count(old)!=1:
        raise SystemExit(f"Unexpected App.tsx layout: {name}, count={text.count(old)}")
    text=text.replace(old,new,1)
replace("import {createDrawerNavigator} from '@react-navigation/drawer';",
"""import {createDrawerNavigator, DrawerContentScrollView, DrawerItem} from '@react-navigation/drawer';
import type {DrawerContentComponentProps} from '@react-navigation/drawer';""","drawer import")
replace("  SidebarContent,\n","","sidebar import")
replace("  ChatScreen,\n","","chat import")
replace("import {OnboardingStack} from './src/screens/OnboardingScreens';",
"import {InterpreterScreen} from './src/screens/InterpreterScreen';","screen import")
replace("  if (!uiStore.hasCompletedOnboarding) {\n    return <OnboardingStack />;\n  }\n","","skip onboarding")
replace("const screenWidth = Dimensions.get('window').width;",
"""const screenWidth = Dimensions.get('window').width;
const InterpreterDrawer = (props: DrawerContentComponentProps) => (
  <DrawerContentScrollView {...props}>
    <DrawerItem label="양방향 통역" onPress={() => props.navigation.navigate(ROUTES.CHAT)} />
    <DrawerItem label="모델 관리" onPress={() => props.navigation.navigate(ROUTES.MODELS)} />
    <DrawerItem label="설정" onPress={() => props.navigation.navigate(ROUTES.SETTINGS)} />
  </DrawerContentScrollView>
);""","new drawer")
replace("drawerContent={props => (\n                              <SidebarContent {...props} />\n                            )}",
        "drawerContent={props => <InterpreterDrawer {...props} />}","sidebar replacement")
replace("component={gestureHandlerRootHOC(ChatScreen)}","component={gestureHandlerRootHOC(InterpreterScreen)}","route")
app.write_text(text)
for f in source.rglob("*"):
    if f.is_file():
        target=base/"src"/f.relative_to(source)
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,target)
# Android 11+ package visibility: required to discover system TTS engines.
# Without this declaration TextToSpeech.initialize can report engine unavailable.
manifest=base/"android/app/src/main/AndroidManifest.xml"
xml=manifest.read_text()
tts_query='android.intent.action.TTS_SERVICE'
if tts_query not in xml:
    anchor='    </queries>'
    if xml.count(anchor)!=1:
        raise SystemExit("AndroidManifest <queries> anchor not found")
    xml=xml.replace(anchor,
      '        <intent>\n'
      '            <action android:name="android.intent.action.TTS_SERVICE" />\n'
      '        </intent>\n'
      +anchor,1)
    manifest.write_text(xml)
p=base/"app.json"
if p.exists():
    obj=json.loads(p.read_text())
    obj["displayName"]="PLaMo Voice"
    p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n")
p=base/"android/app/src/main/res/values/strings.xml"
s=p.read_text().replace('<string name="app_name">PocketPal</string>',
                        '<string name="app_name">PLaMo Voice</string>')
p.write_text(s)
p=base/"android/app/build.gradle"
s=p.read_text().replace('applicationId "com.pocketpalai"','applicationId "com.plamovoice.redmi"').replace('abiFilters "arm64-v8a", "x86_64"','abiFilters "arm64-v8a"')
p.write_text(s)
# Bridge sherpa-onnx AAR to the PocketPal React Native application.
native=Path(__file__).resolve().parent/"native/SenseVoiceModule.kt"
module=base/"android/app/src/main/java/com/pocketpalai/SenseVoiceModule.kt"
module.parent.mkdir(parents=True,exist_ok=True)
shutil.copy2(native,module)

application=base/"android/app/src/main/java/com/pocketpalai/MainApplication.kt"
appsrc=application.read_text()
anchor="              add(NavigationBarPackage())"
if appsrc.count(anchor)!=1:
    raise SystemExit("MainApplication package anchor changed")
appsrc=appsrc.replace(anchor,anchor+"\n              add(SenseVoicePackage())",1)
application.write_text(appsrc)

gradle=base/"android/app/build.gradle"
build=gradle.read_text()
if 'implementation(files("libs/sherpa-onnx-2.0.1.aar"))' not in build:
    build += '\n// Pinned sherpa-onnx v2.0.1 Android release AAR, downloaded by CI.\n'
    build += 'dependencies { implementation(files("libs/sherpa-onnx-2.0.1.aar")) }\n'
# Avoid duplicate ONNX Runtime libraries from onnxruntime-react-native and
# sherpa-onnx Android AAR. For now retain one shared ABI binary; verify
# ASR and TTS on device as these components may expect different ORT APIs.
packaging = """
android {
    packaging {
        jniLibs {
            pickFirsts += ["lib/arm64-v8a/libonnxruntime.so"]
        }
    }
}
"""
build += "\n" + packaging
gradle.write_text(build)

print("PocketPal interpreter overlay applied")
