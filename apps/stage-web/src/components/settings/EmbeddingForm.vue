<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue'
import {t} from '../../i18n'
import {useSettingsStore} from '../../stores/settings'
import {useSaveFlash} from '../../composables/use-save-flash'
import SettingsSelect from './SettingsSelect.vue'
const error=ref('')
const settings=useSettingsStore(),{saved,flashSaved}=useSaveFlash()
const initial=()=>({endpoint:settings.config.memory.embedding?.endpoint??'',model:settings.config.memory.embedding?.model??'qwen3.7-text-embedding',
  credentialSource:settings.config.memory.embedding?.credentialSource??'reuse',apiKey:settings.config.memory.embedding?.apiKey??''})
const draft=reactive(initial())
watch(()=>settings.config.memory.embedding,()=>Object.assign(draft,initial()),{deep:true})
const dirty=computed(()=>JSON.stringify(draft)!==JSON.stringify(initial()))
async function save(){error.value='';try{await settings.saveEmbedding({endpoint:draft.endpoint.trim(),model:draft.model.trim(),credentialSource:draft.credentialSource,
  ...(draft.credentialSource==='dedicated'?{apiKey:draft.apiKey.trim()}:{})});flashSaved()}catch{error.value='Could not save settings.'}}
</script>
<template>
  <section class="embedding-settings" aria-labelledby="embedding-title">
    <h3 id="embedding-title" class="module-section-title">{{t('Embedding Model')}}</h3>
    <form class="form" @submit.prevent="save">
      <div class="field"><span class="label">{{t('Provider')}}</span><SettingsSelect model-value="dashscope" :label="t('Provider')" :options="[{value:'dashscope',label:'DashScope (Native API)'}]" /></div>
      <label class="field"><span class="label">{{t('Model')}}</span><input v-model="draft.model" type="text" required placeholder="qwen3.7-text-embedding" /></label>
      <label class="field"><span class="label">{{t('API Endpoint')}}</span><input v-model="draft.endpoint" type="url" placeholder="https://dashscope.aliyuncs.com" /></label>
      <div class="field"><span class="label">{{t('Credential source')}}</span><SettingsSelect v-model="draft.credentialSource" :label="t('Credential source')" :options="[{value:'reuse',label:t('Reuse existing DashScope')},{value:'dedicated',label:t('Dedicated DashScope key')}]" /></div>
      <label v-if="draft.credentialSource==='dedicated'" class="field"><span class="label">{{t('API Key')}}</span><input v-model="draft.apiKey" type="password" required autocomplete="off" /></label>
      <div class="actions"><button class="btn primary" type="submit" :disabled="!dirty">{{t('Save')}}</button></div>
      <p v-if="error" class="status error" role="status">{{t(error)}}</p>
      <p v-if="saved" class="status saved">{{t('Saved.')}}</p>
    </form>
  </section>
</template>

<style scoped>
.embedding-settings { margin: 1.5rem 0 }
</style>
