import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

describe("shadcn ui components smoke", () => {
  it("Button renders with variant + size", () => {
    const { container } = render(
      <Button variant="primary" size="md">
        Click
      </Button>,
    );
    expect(container.querySelector("button")).toBeInTheDocument();
    expect(container.textContent).toBe("Click");
  });

  it("Card family renders without throwing", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(container.textContent).toContain("Title");
    expect(container.textContent).toContain("Footer");
  });

  it("Switch renders with checked state", () => {
    const { container } = render(<Switch checked={true} onCheckedChange={() => undefined} />);
    expect(container.querySelector("button[role='switch']")).toBeInTheDocument();
  });

  it("Select renders trigger", () => {
    const { container } = render(
      <Select defaultValue="a">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(container.querySelector("button")).toBeInTheDocument();
  });

  it("Tabs renders list and triggers", () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
      </Tabs>,
    );
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("Content A");
  });

  it("DropdownMenu renders trigger", () => {
    const { container } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(container.textContent).toContain("Open");
  });

  it("Dialog renders trigger and supports controlled open", () => {
    const { container } = render(
      <Dialog open={false} onOpenChange={() => undefined}>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(container.textContent).toContain("Open");
  });

  it("Input renders with placeholder", () => {
    const { container } = render(<Input placeholder="type here" />);
    const input = container.querySelector("input");
    expect(input).toBeInTheDocument();
    expect(input?.getAttribute("placeholder")).toBe("type here");
  });

  it("Tooltip provider wraps trigger", () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(container.textContent).toContain("Hover");
  });

  it("Separator renders horizontal default", () => {
    const { container } = render(<Separator />);
    expect(
      container.querySelector("[role='none'], [data-orientation='horizontal']"),
    ).toBeInTheDocument();
  });
});
