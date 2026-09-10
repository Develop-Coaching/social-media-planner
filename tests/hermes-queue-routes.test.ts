import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), list: vi.fn(), resolve: vi.fn(), move: vi.fn() }));
vi.mock("@/lib/hermes-social/auth", () => ({ verifyHermesRequest: mocks.verify,
  HermesAuthError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
vi.mock("@/lib/hermes-social/repository", async () => ({
  ...await vi.importActual<typeof import("../src/lib/hermes-social/repository")>("../src/lib/hermes-social/repository"),
  listHermesQueue: mocks.list, resolveHermesQueue: mocks.resolve, rescheduleHermesQueue: mocks.move,
}));
import { GET as queue } from "../src/app/api/hermes/v1/social-schedules/queue/route";
import { GET as resolve } from "../src/app/api/hermes/v1/social-schedules/resolve/route";
import { POST as move } from "../src/app/api/hermes/v1/social-schedules/reschedule/route";
import { HermesRepositoryError } from "../src/lib/hermes-social/repository";
const id="20000000-0000-4000-8000-000000000001";
const identity={userId:"demo-user",companyId:"demo-company",requestId:id,actor:"hermes:demo",requestFingerprintSha256:"a".repeat(64),rawBody:Buffer.alloc(0)};
const body={expectedEpoch:2,approvalReference:"approval:synthetic",changes:[{contentItemId:id,expectedScheduledAt:"2099-09-11T11:00:00Z",scheduledAt:"2099-09-25T11:00:00Z",expectedContentSha256:"b".repeat(64)}]};
const request=(path:string)=>new NextRequest(`https://example.invalid/api/hermes/v1/social-schedules/${path}`);
beforeEach(()=>{vi.clearAllMocks();mocks.verify.mockResolvedValue(identity);});
describe("Hermes queue routes",()=>{
  it("passes signed tenant identity and bounded pagination",async()=>{
    mocks.list.mockResolvedValue({ownershipEpoch:2,items:[],nextCursor:null});
    const response=await queue(request(`queue?limit=3&cursor=${id}&from=2099-09-01T00:00:00Z&to=2099-10-01T00:00:00Z`));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.list).toHaveBeenCalledWith(identity,{limit:3,cursor:id,from:"2099-09-01T00:00:00Z",to:"2099-10-01T00:00:00Z"});
  });
  it.each(["queue?companyId=other","queue?limit=0","queue?limit=101","queue?limit=1&limit=2","queue?cursor=bad","queue?from=2099-01-01","queue?from=2099-02-01T00:00:00Z&to=2099-01-01T00:00:00Z"])("rejects unsafe queue query %s",async(path)=>{
    expect((await queue(request(path))).status).toBe(400);expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["contentItemId","legacySppId","scheduleId"])("resolves %s within tenant",async(key)=>{
    mocks.resolve.mockResolvedValue({contentItemId:id});expect((await resolve(request(`resolve?${key}=${id}`))).status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(identity,expect.objectContaining({[key]:id}));
  });
  it("rejects ambiguous resolver requests and hides absent/cross-tenant records",async()=>{
    expect((await resolve(request(`resolve?contentItemId=${id}&legacySppId=${id}`))).status).toBe(400);
    expect((await resolve(request("resolve"))).status).toBe(400);
    mocks.resolve.mockResolvedValue(null);expect((await resolve(request(`resolve?contentItemId=${id}`))).status).toBe(404);
  });
  it("moves a batch under the signed identity and supports replay",async()=>{
    mocks.verify.mockResolvedValue({...identity,rawBody:Buffer.from(JSON.stringify(body))});mocks.move.mockResolvedValue({replayed:true,changes:body.changes});
    const response=await move(request("reschedule"));expect(response.status).toBe(200);expect((await response.json()).replayed).toBe(true);
    expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({requestId:id,userId:identity.userId}),body);
  });
  it.each([
    {...body,companyId:"other"},{...body,changes:[]},{...body,changes:Array(21).fill(body.changes[0])},
    {...body,changes:[...body.changes,...body.changes]},
    {...body,changes:[{...body.changes[0],scheduledAt:"2099-09-25T11:00:00"}]},
    {...body,changes:[{...body.changes[0],platforms:["facebook"]}]},
    {...body,changes:[{...body.changes[0],expectedContentSha256:"bad"}]},
  ])("rejects invalid mutation %# before repository access",async(input)=>{
    mocks.verify.mockResolvedValue({...identity,rawBody:Buffer.from(JSON.stringify(input))});expect((await move(request("reschedule"))).status).toBe(400);expect(mocks.move).not.toHaveBeenCalled();
  });
  it("returns stale/lease conflicts without partial success",async()=>{
    mocks.verify.mockResolvedValue({...identity,rawBody:Buffer.from(JSON.stringify(body))});mocks.move.mockRejectedValue(new HermesRepositoryError("queue preview is stale",409));
    const response=await move(request("reschedule"));expect(response.status).toBe(409);expect(await response.json()).toEqual({error:"queue preview is stale"});
  });
  it("authenticates before queue access or parsing",async()=>{
    mocks.verify.mockRejectedValue(new Error("bad signature"));expect((await queue(request("queue"))).status).toBe(500);expect(mocks.list).not.toHaveBeenCalled();
  });
});
