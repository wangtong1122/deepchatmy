import {MessageStream} from '../../views/chat/messages/stream/messageStream';
import {MessageUtils} from '../../views/chat/messages/messageUtils';
import {ErrorMessages} from '../errorMessages/errorMessages';
import {Messages} from '../../views/chat/messages/messages';
import {RequestDetails} from '../../types/interceptors';
import {RoleToStream, Websocket} from './websocket';
import {ServiceIO} from '../../services/serviceIO';
import {Response} from '../../types/response';
import {RequestUtils} from './requestUtils';
import {Stream} from './stream';

export interface IWebsocketHandler {
  isOpen: boolean;
  newUserMessage: {listener: (text: string) => void};
}

export class CustomHandler {
  // 非stream走这里
  public static async request(io: ServiceIO, body: RequestDetails['body'], messages: Messages) {
    let isHandlerActive = true;
    const onResponse = async (response: Response) => {
      if (!isHandlerActive && !response.overwrite) return; //这里导致了普通的HTTP请求有问题
      isHandlerActive = false; // need to set it here due to asynchronous code below
      const result = (await io.deepChat.responseInterceptor?.(response)) || response;
      if (!RequestUtils.validateResponseFormat(result)) {
        console.error(ErrorMessages.INVALID_RESPONSE(response, 'server', !!io.deepChat.responseInterceptor, result));
        messages.addNewErrorMessage('service', 'Error in server message');
        io.completionsHandlers.onFinish();
      } else if (typeof result.error === 'string') {
        console.error(result.error);
        messages.addNewErrorMessage('service', result.error);
        io.completionsHandlers.onFinish();
      } else if (Stream.isSimulatable(io.stream, result)) {
        Stream.simulate(messages, io.streamHandlers, result);
      } else {
        messages.addNewMessage(result);
        io.completionsHandlers.onFinish();
      }
    };

    const signals = CustomHandler.generateOptionalSignals();
    io.connectSettings.handler?.(body, {...signals, onResponse});
  }

  private static attemptToFinaliseStream(stream: MessageStream, messages: Messages) {
    try {
      stream.finaliseStreamedMessage();
    } catch (error) {
      console.error(error);
      messages.addNewErrorMessage('service', error as Error);
    }
  }

  // prettier-ignore
  public static stream(io: ServiceIO, body: RequestDetails['body'], messages: Messages) {
    let isHandlerActive = true;
    let isOpen = false;
    // 这里创建stream是一个MessageStream实例
    const stream = new MessageStream(messages);
    const onOpen = () => {
      if (isOpen || !isHandlerActive) return;
      io.streamHandlers.onOpen();
      isOpen = true;
    };
    const onClose = () => {
      if (!isHandlerActive) return;
      CustomHandler.attemptToFinaliseStream(stream, messages);
      io.streamHandlers.onClose();
      isHandlerActive = false;
    };
    const onResponse = async (response: Response) => {
      if (!isHandlerActive) return;
      const result = (await io.deepChat.responseInterceptor?.(response)) || response;
      if (!RequestUtils.validateResponseFormat(result)) {
        console.error(ErrorMessages.INVALID_RESPONSE(response, 'server', !!io.deepChat.responseInterceptor, result));
      } else if (result.error) {
        console.error(result.error);
        // 如果出错，或者流数据结束了，就调用finaliseStreamedMessage，这里会将
        stream.finaliseStreamedMessage();
        messages.addNewErrorMessage('service', result.error);
        io.streamHandlers.onClose();
        isHandlerActive = false;
      } else {
        // 调用到这里了
        Stream.upsertWFiles(messages, stream.upsertStreamedMessage.bind(stream), stream, result);
      }
    };
    io.streamHandlers.abortStream.abort = () => {
      CustomHandler.attemptToFinaliseStream(stream, messages);
      io.streamHandlers.onClose();
      isHandlerActive = false;
    };
    const signals = CustomHandler.generateOptionalSignals();
    // 返回这些给用户调用
    //     signals.stopClicked.listener = () => {
    //         // logic to stop your stream, such as creating an abortController
    //       };监听停止按钮的调用
    io.connectSettings.handler?.(body,
      {...signals, onOpen, onResponse, onClose, stopClicked: io.streamHandlers.stopClicked});
  }

  // prettier-ignore
  public static websocket(io: ServiceIO, messages: Messages) {
    const internalConfig = {isOpen: false, newUserMessage: {listener: () => {}}, roleToStream: {}};
    io.websocket = internalConfig;
    const onOpen = () => {
      messages.removeError();
      internalConfig.isOpen = true;
    };
    const onClose = () => {
      internalConfig.isOpen = false;
    };
    const onResponse = async (response: Response) => {
      if (!internalConfig.isOpen) return;
      const result = (await io.deepChat.responseInterceptor?.(response)) || response;
      if (!RequestUtils.validateResponseFormat(result)) {
        console.error(ErrorMessages.INVALID_RESPONSE(response, 'server', !!io.deepChat.responseInterceptor, result));
        messages.addNewErrorMessage('service', 'Error in server message');
      } else if (typeof result.error === 'string') {
        console.error(result.error);
        if (!messages.isLastMessageError()) messages.addNewErrorMessage('service', result.error);
      } else if (Stream.isSimulation(io.stream)) {
        const upsertFunc = Websocket.stream.bind(this, io, messages, internalConfig.roleToStream);
        const stream = (internalConfig.roleToStream as RoleToStream)[response.role || MessageUtils.AI_ROLE];
        Stream.upsertWFiles(messages, upsertFunc, stream, response);
      } else {
        messages.addNewMessage(result);
      }
    };
    const signals = CustomHandler.generateOptionalSignals();
    io.connectSettings.handler?.(undefined,
      {...signals, onOpen, onResponse, onClose, newUserMessage: internalConfig.newUserMessage});
  }

  private static generateOptionalSignals() {
    return {onClose: () => {}, onOpen: () => {}, stopClicked: { listener: async () => false}, newUserMessage: {listener: () => {}}};
  }
}
