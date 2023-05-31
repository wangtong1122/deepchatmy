import {CameraFilesServiceConfig, FilesServiceConfig, RecordAudioFilesServiceConfig} from '../../types/fileServiceConfigs';
import {RemarkableConfig} from '../../views/chat/messages/remarkable/remarkableConfig';
import {ValidateMessageBeforeSending} from '../../types/validateMessageBeforeSending';
import {CustomServiceConfig, CustomServiceResponse} from '../../types/customService';
import {RequestInterceptor, ResponseInterceptor} from '../../types/interceptors';
import {PermittedErrorMessage} from '../../types/permittedErrorMessage';
import {MessageLimitUtils} from '../utils/messageLimitUtils';
import {Messages} from '../../views/chat/messages/messages';
import {RequestSettings} from '../../types/requestSettings';
import {FileAttachments} from '../../types/fileAttachments';
import {HTTPRequest} from '../../utils/HTTP/HTTPRequest';
import {Demo as DemoClass} from '../../utils/demo/demo';
import {MessageLimits} from '../../types/chatLimits';
import {MessageContent} from '../../types/messages';
import {AiAssistant} from '../../aiAssistant';
import {Result} from '../../types/result';
import {Demo} from '../../types/demo';
import {
  KeyVerificationHandlers,
  CompletionsHandlers,
  ServiceFileTypes,
  StreamHandlers,
  FileServiceIO,
  ServiceIO,
} from '../serviceIO';

// GCP should be included here
/* eslint-disable @typescript-eslint/no-explicit-any */
export class CustomServiceIO implements ServiceIO {
  private readonly _raw_body: any;
  fileTypes: ServiceFileTypes = {};
  camera?: CameraFilesServiceConfig;
  recordAudio?: RecordAudioFilesServiceConfig;
  canSendMessage: ValidateMessageBeforeSending = CustomServiceIO.canSendMessage;
  requestSettings: RequestSettings = {};
  private readonly displayServiceErrorMessages?: boolean;
  requestInterceptor: RequestInterceptor = (body) => body;
  responseInterceptor: ResponseInterceptor = (result) => result;
  private readonly _isStream: boolean = false;
  private readonly _total_messages_max_char_length?: number;
  private readonly _max_messages?: number;
  private readonly _isTextOnly?: boolean;
  demo?: Demo;
  validateConfigKey = false;

  constructor(aiAssistant: AiAssistant) {
    const customService = aiAssistant.service?.custom;
    if (!customService?.request && !customService?.demo) {
      throw new Error('please define a request property in custom: {request: ...}');
    }
    if (customService.request) this.requestSettings = customService.request;
    if (customService.requestInterceptor) this.requestInterceptor = customService.requestInterceptor;
    if (customService.responseInterceptor) this.responseInterceptor = customService.responseInterceptor;
    if (customService.images) {
      this.fileTypes.images = CustomServiceIO.parseConfig(customService.images, this.requestSettings, 'image/*');
    }
    this.processCamera(customService);
    if (customService.audio) {
      this.fileTypes.audio = CustomServiceIO.parseConfig(customService.audio, this.requestSettings, 'audio/*');
      if (this.fileTypes.audio.files) this.fileTypes.audio.files.maxNumberOfFiles ??= this.camera?.files?.maxNumberOfFiles;
    }
    this.processRecordAudio(customService);
    if (customService.mixedFiles) {
      this.fileTypes.mixedFiles = CustomServiceIO.parseConfig(customService.mixedFiles, this.requestSettings, '');
    }
    this.displayServiceErrorMessages = customService?.displayServiceErrorMessages;
    this._isStream = !!customService?.stream;
    this._total_messages_max_char_length = customService.total_messages_max_char_length;
    this._max_messages = customService.max_messages;
    if (customService) CustomServiceIO.cleanConfig(customService as Partial<CustomServiceConfig>);
    this._raw_body = customService;
    this._isTextOnly = !this.camera && !this.recordAudio && Object.keys(this.fileTypes).length === 0;
    this.demo = customService.demo;
    if (this.demo) this.requestSettings.url = DemoClass.URL;
  }

  private static canSendMessage(text: string, files?: File[]) {
    return !!files?.[0] || text.trim() !== '';
  }

  // prettier-ignore
  private static parseConfig(fileType: boolean | FilesServiceConfig,
      requestSettings: RequestSettings, defAcceptedFormats: string) {
    const fileConfig: FileServiceIO & {files: FileAttachments} = {files: {acceptedFormats: defAcceptedFormats}};
    if (typeof fileType === 'object') {
      const {files, request, requestInterceptor, responseInterceptor, button} = fileType;
      if (files) {
        if (files.infoModal) {
          fileConfig.files.infoModal = files.infoModal;
          if (files.infoModal?.textMarkDown) {
            const remarkable = RemarkableConfig.createNew();
            fileConfig.infoModalTextMarkUp = remarkable.render(files.infoModal.textMarkDown);
          }
        }
        if (files.acceptedFormats) fileConfig.files.acceptedFormats = files.acceptedFormats;
        if (files.maxNumberOfFiles) fileConfig.files.maxNumberOfFiles = files.maxNumberOfFiles;
      }
      fileConfig.button = button;
      fileConfig.request = {
        headers: request?.headers || requestSettings.headers,
        method: request?.method || requestSettings.method,
        url: request?.url || requestSettings.url,
      };
      fileConfig.requestInterceptor = requestInterceptor;
      fileConfig.responseInterceptor = responseInterceptor;
    }
    return fileConfig;
  }

  private processCamera(customService: CustomServiceConfig) {
    if (!customService.camera) return;
    if (navigator.mediaDevices.getUserMedia !== undefined) {
      this.camera = CustomServiceIO.parseConfig(customService.camera, this.requestSettings, 'image/*');
      if (typeof customService.camera === 'object') {
        this.camera.modalContainerStyle = customService.camera.modalContainerStyle;
        // adding configuration that parseConfig does not add (don't want to overwrite as it may have processed properties)
        if (customService.camera.files) {
          this.camera.files ??= {}; // for typescript
          this.camera.files.format = customService.camera.files?.format;
          // this.camera.files.newFilePrefix = customService.camera.files?.newFilePrefix; // can implement in the future
          this.camera.files.dimensions = customService.camera.files?.dimensions;
        }
      }
      // if camera is not available - fallback to normal image upload
    } else if (!customService.images) {
      this.fileTypes.images = CustomServiceIO.parseConfig(customService.camera, this.requestSettings, 'image/*');
    }
  }

  private processRecordAudio(customService: CustomServiceConfig) {
    if (!customService.microphoneAudio) return;
    if (navigator.mediaDevices.getUserMedia !== undefined) {
      this.recordAudio = CustomServiceIO.parseConfig(customService.microphoneAudio, this.requestSettings, 'audio/*');
      // adding configuration that parseConfig does not add (don't want to overwrite as it may have processed properties)
      if (typeof customService.microphoneAudio === 'object') {
        if (customService.microphoneAudio.files) {
          this.recordAudio.files ??= {}; // for typescript
          this.recordAudio.files.format = customService.microphoneAudio.files?.format;
          // this.recordAudio.files.newFilePrefix = customService.microphoneAudio.files?.newFilePrefix;
          this.recordAudio.files.maxDurationSeconds = customService.microphoneAudio.files?.maxDurationSeconds;
        }
      }
      // if microphone is not available - fallback to normal audio upload
    } else if (!customService.audio) {
      this.fileTypes.audio = CustomServiceIO.parseConfig(customService.microphoneAudio, this.requestSettings, 'audio/*');
    }
  }

  private static cleanConfig(config: Partial<CustomServiceConfig> & MessageLimits) {
    delete config.images;
    delete config.camera;
    delete config.audio;
    delete config.microphoneAudio;
    delete config.mixedFiles;
    delete config.request;
    delete config.stream;
    delete config.requestInterceptor;
    delete config.responseInterceptor;
    delete config.displayServiceErrorMessages;
    delete config.max_messages;
    delete config.total_messages_max_char_length;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verifyKey(_key: string, _keyVerificationHandlers: KeyVerificationHandlers) {}

  private static createFormDataBody(body: any, messages: MessageContent[], files: File[]) {
    const formData = new FormData();
    files.forEach((file, index) => formData.append(`file${index + 1}`, file));
    Object.keys(body).forEach((key) => formData.append(key, String(body[key])));
    let textMessageIndex = 0;
    messages.forEach((message) => {
      if (message.text) formData.append(`message${(textMessageIndex += 1)}`, JSON.stringify(message));
    });
    return formData;
  }

  // prettier-ignore
  private callApiWithFiles(messages: Messages, completionsHandlers: CompletionsHandlers,
      processedMessages: MessageContent[], files: File[], fileIO?: FileServiceIO) {
    const formData = CustomServiceIO.createFormDataBody(this._raw_body, processedMessages, files);
    const previousRequestSettings = this.requestSettings;
    this.requestSettings = fileIO?.request || this.requestSettings;
    // this requestInterceptor is for more fine grained monitoring
    fileIO?.requestInterceptor?.({body: formData, headers: this.requestSettings.headers});
    HTTPRequest.request(this, formData, messages, completionsHandlers.onFinish, false);
    this.requestSettings = previousRequestSettings;
  }

  // prettier-ignore
  callApi(messages: Messages, completionsHandlers: CompletionsHandlers, streamHandlers: StreamHandlers,
      files?: File[]) {
    if (!this.requestSettings) throw new Error('Request settings have not been set up');
    const processedMessages = MessageLimitUtils.processMessages(
      messages.messages, 0, this._max_messages, this._isTextOnly ? this._total_messages_max_char_length : undefined);
    if (files) {
      const fileIO = this.getServiceIOByType(files[0]);
      this.callApiWithFiles(messages, completionsHandlers, processedMessages, files, fileIO);
    } else {
      const body = {messages: processedMessages, ...this._raw_body};
      if (this._isStream) {
        HTTPRequest.requestStream(this, body, messages,
          streamHandlers.onOpen, streamHandlers.onClose, streamHandlers.abortStream);
      } else {
        HTTPRequest.request(this, body, messages, completionsHandlers.onFinish);
      }
    }
  }

  private getServiceIOByType(file: File) {
    if (file.type.startsWith('audio') && this.fileTypes.audio) {
      return this.fileTypes.audio;
    }
    if (file.type.startsWith('image')) {
      if (this.fileTypes.images) {
        return this.fileTypes.images;
      } else if (this.camera) {
        return this.camera;
      }
    }
    return this.fileTypes.mixedFiles;
  }

  async extractResultData(result: CustomServiceResponse): Promise<Result> {
    if (result.error) {
      if (this.displayServiceErrorMessages) {
        // eslint-disable-next-line no-throw-literal
        throw {permittedErrorMessage: result.error} as PermittedErrorMessage;
      }
      throw result.error;
    }
    return result.result as Result;
  }
}
