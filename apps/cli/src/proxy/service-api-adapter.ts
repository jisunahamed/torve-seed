export {
  createStreamingAdapter,
  detectRequestServiceApiProtocol,
  extractRequestBodyFields,
  inferProviderDefaultServiceApiProtocols,
  isNativeVideoProtocol,
  selectTargetProtocolForRequest,
  transformRequest,
  transformResponse,
} from '@torveai/api-adapter'

export type {
  ServiceApiRequestTransformOptions,
  ServiceApiRequestTransformResult,
  ServiceApiResponseTransformOptions,
  ServiceApiStreamTransformOptions,
  SerializedHttpResponse,
  SerializedHttpResponseChunk,
  ServiceApiProtocol,
  StreamingResponseAdapter,
  TargetProtocolSelection,
} from '@torveai/api-adapter'
