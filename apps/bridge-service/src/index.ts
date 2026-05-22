export type BridgeServiceRole = 'stateful-edge-actor' | 'persistent-availability-peer';

export const bridgeServicePlaceholder = {
  role: 'stateful-edge-actor' satisfies BridgeServiceRole,
  authoritativeForPrivateState: false
};
