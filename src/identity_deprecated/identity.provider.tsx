import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useRef,
  MutableRefObject,
} from "react";
import { mnemonicToAccount, Account } from "viem/accounts";
import { Actor, HttpAgent } from "@dfinity/agent";
import {
  LOCAL_STORAGE_EVM_WALLET_MNEMONIC,
  LOCAL_STORAGE_ALIAS_NICKNAME,
  LOCAL_STORAGE_ONBOARDING_CHECKPOINT,
  ONBOARDING_CHECKPOINTS,
  LOCAL_STORAGE_ICP_WALLET_MNEMONIC,
  FACTORY_CANISTER_ID,
  LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID,
} from "./constants";
import { createDefaultAnonEVMIdentity, shortenAddress } from "./evm-auth"; // Adjust the import path to where your utils file is located.
import {
  generateICPIdentityWithMnemonic,
  ICPAccount,
  restoreICPIdentityFromMnemonic,
} from "./icp-auth";
import { trackUserSignup } from "../tracking/tracking";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { idlFactory as idlFactory_Factory } from "../declarations/factory-canister/factory-canister.did.js";
import { idlFactory as idlFactory_Drive } from "../declarations/officex-canisters-backend/officex-canisters-backend.did.js";

export interface IdentityContextProps {
  evmAccount: Account | null;
  evmSlug: string;
  icpAccount: ICPAccount | null;
  icpSlug: string;
  icpCanister: string;
  alias: string;
  icpAgent: MutableRefObject<HttpAgent | undefined>; // Added icpAgent
  deployIcpCanister: () => void;
  initializeIdentity: (m: string) => void;
}

const IdentityContext = createContext<IdentityContextProps | undefined>(
  undefined
);

export const IdentityProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const icpAgent = useRef<HttpAgent>();
  const [identity, setIdentity] = useState<{
    evmAccount: Account | null;
    evmSlug: string;
    icpAccount: ICPAccount | null;
    icpSlug: string;
    alias: string;
  }>({
    evmAccount: null,
    evmSlug: "0x0",
    icpAccount: null,
    icpSlug: "0i0",
    alias: "0x0",
  });
  const [icpCanister, setIcpCanister] = useState<string>("");

  useEffect(() => {
    initializeIdentity();
  }, []);

  const initializeIdentity = async (icpMnemonic?: string) => {
    const existingEvmMnemonic = localStorage.getItem(
      LOCAL_STORAGE_EVM_WALLET_MNEMONIC
    );
    const _existingIcpMnemonic = localStorage.getItem(
      LOCAL_STORAGE_ICP_WALLET_MNEMONIC
    );
    const existingIcpMnemonic = icpMnemonic || _existingIcpMnemonic || "";
    localStorage.setItem(
      LOCAL_STORAGE_ICP_WALLET_MNEMONIC,
      existingIcpMnemonic
    );
    const existingAlias = localStorage.getItem(LOCAL_STORAGE_ALIAS_NICKNAME);
    console.log("Existing EVM Mnemonic:", existingEvmMnemonic);
    console.log("Existing ICP Mnemonic:", existingIcpMnemonic);
    if (existingEvmMnemonic && existingIcpMnemonic) {
      console.log("Restoring existing identity");
      // Convert the mnemonic to an account object
      const evmAccount = mnemonicToAccount(existingEvmMnemonic);
      const icpAccount =
        await restoreICPIdentityFromMnemonic(existingIcpMnemonic);

      // Compute the slug from the account address
      const evmSlug = shortenAddress(evmAccount.address);
      const icpSlug = shortenAddress(icpAccount.principal.toText());

      // Save the initialized ICP Agent instance
      localStorage.removeItem(LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID);
      await initIcpAgent(icpAccount.identity);

      setIdentity({
        evmAccount: evmAccount,
        icpAccount: icpAccount,
        alias: existingAlias || "", // Use the stored alias or empty string if not found
        evmSlug,
        icpSlug,
      });
    } else {
      console.log("Creating new anon identity");
      // Create a new default anonymous identity
      const newEVMIdentity = await createDefaultAnonEVMIdentity();
      const newICPIdentity = await generateICPIdentityWithMnemonic();
      await initIcpAgent(newICPIdentity.identity);
      setIdentity({
        evmAccount: newEVMIdentity.account,
        evmSlug: newEVMIdentity.slug,
        icpAccount: newICPIdentity,
        icpSlug: shortenAddress(newICPIdentity.principal.toText()),
        alias: newEVMIdentity.alias,
      });
      localStorage.setItem(
        LOCAL_STORAGE_ONBOARDING_CHECKPOINT,
        ONBOARDING_CHECKPOINTS.FRESH_USER
      );
      await trackUserSignup(newICPIdentity.principal.toText());
    }
  };
  const initIcpAgent = async (identity: Ed25519KeyIdentity) => {
    // Determine if we're running in production
    const hostname = window.location.hostname;
    const isProduction = hostname === "drive.officex.app";

    if (isProduction) return;

    // Set the host URL
    const host = isProduction ? "https://icp-api.io" : "http://localhost:4943";

    const agent = new HttpAgent({ identity, host });

    console.log(`Hostname: ${hostname}`);
    console.log(`Is Production: ${isProduction}`);

    // Fetch the root key only if not in production
    if (!isProduction) {
      try {
        await agent.fetchRootKey();
        console.log("Fetched root key for non-production environment.");
      } catch (error) {
        console.error("Error fetching root key:", error);
      }
    } else {
      console.log("Production environment detected. Skipping root key fetch.");
    }

    icpAgent.current = agent;

    await retrieveIcpCanister();
  };

  const retrieveIcpCanister = async () => {
    // check local storage
    const canisterId = localStorage.getItem(
      LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID
    );
    if (canisterId) {
      // set to usestate
      setIcpCanister(canisterId);
      // check ping
      await pingIcpCanister(canisterId);
    } else {
      console.log(
        "No ICP Canister found in local storage, try public key directly"
      );
      const actor = Actor.createActor(idlFactory_Factory, {
        agent: icpAgent.current,
        canisterId: FACTORY_CANISTER_ID,
      });
      const res = (await actor.get_user_drive()) as any;
      console.log(res);
      if (res[0]) {
        const driveId = res[0];
        setIcpCanister(driveId);
        localStorage.setItem(LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID, driveId);
        await pingIcpCanister(driveId);
      }
    }
  };

  // called when the user clicks the "Deploy ICP Canister" button
  const deployIcpCanister = async () => {
    console.log("Deploying ICP Canister");

    const actor = Actor.createActor(idlFactory_Factory, {
      agent: icpAgent.current,
      canisterId: FACTORY_CANISTER_ID,
    });

    const balance = await actor.get_canister_balance();
    console.log(`Canister balance: ${balance}`);

    const result = (await actor.create_drive(identity.alias)) as {
      Ok: string /** CanisterID */;
      Err: string;
    };
    console.log(`Result of creating drive canister`, result);
    if (result.Ok) {
      console.log(`Drive canister created: ${result.Ok}`);
      setIcpCanister(result.Ok);
      localStorage.setItem(LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID, result.Ok);
      await pingIcpCanister(result.Ok);
    }
    if (result.Err) {
      console.error(`Error creating drive canister: ${result.Err}`);
      if (result.Err == "User already has a drive") {
        const res = (await actor.get_user_drive()) as any;
        console.log(res);
        if (res[0]) {
          const driveId = res[0];
          setIcpCanister(driveId);
          localStorage.setItem(LOCAL_STORAGE_ICP_CANISTER_DRIVE_ID, driveId);
          await pingIcpCanister(driveId);
        }
      }
    }
  };

  const pingIcpCanister = async (id: string = icpCanister) => {
    const actor = Actor.createActor(idlFactory_Drive, {
      agent: icpAgent.current,
      canisterId: id,
    });
    const res = await actor.ping();
    console.log(`Ping response: ${res}`);
  };

  return (
    <IdentityContext.Provider
      value={{
        ...identity,
        icpAgent,
        icpCanister,
        deployIcpCanister,
        initializeIdentity,
      }}
    >
      {children}
    </IdentityContext.Provider>
  );
};

export const useIdentity = (): IdentityContextProps => {
  const context = useContext(IdentityContext);
  if (context === undefined) {
    throw new Error("useIdentity must be used within an IdentityProvider!");
  }
  return context;
};
