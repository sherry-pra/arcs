package arcs.api;

import java.util.function.Consumer;

public interface PECInnerPort {
  void handleMessage(PortableJson message);
  void InitializeProxy(StorageProxy storageProxy, Consumer<PortableJson> callback);
  void SynchronizeProxy(StorageProxy storageProxy, Consumer<PortableJson> callback);
  // TODO: add more methods.
}
