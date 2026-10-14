<template>
  <div class="content-box">
    <div v-if="document.hasImages && !showImages" class="image-notice">
      <span>{{ t('emailImagesBlocked') }}</span>
      <button type="button" @click="showImages = true">{{ t('showEmailImages') }}</button>
    </div>
    <iframe
        ref="frame"
        class="email-frame"
        :title="t('emailBody')"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        :srcdoc="document.srcdoc"
        :style="{ height: `${height}px` }"
        @load="observeContent"
    ></iframe>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildEmailDocument } from '@/utils/email-html.js'

const props = defineProps({ html: { type: String, required: true } })
const { t } = useI18n()
const frame = ref(null)
const height = ref(120)
const showImages = ref(false)
const document = computed(() => buildEmailDocument(props.html, { images: showImages.value }))
let observer

watch(() => props.html, () => {
  showImages.value = false
  height.value = 120
}, { flush: 'sync' })

function observeContent() {
  observer?.disconnect()
  const body = frame.value?.contentDocument?.body
  if (!body) return
  const resize = () => {
    height.value = Math.max(80, Math.ceil(body.getBoundingClientRect().height) + 24)
  }
  resize()
  observer = new ResizeObserver(resize)
  observer.observe(body)
}

onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.content-box { width: 100%; }
.email-frame { display: block; width: 100%; border: 0; background: #fff; }
.image-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.image-notice button {
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
  font: inherit;
}
</style>
