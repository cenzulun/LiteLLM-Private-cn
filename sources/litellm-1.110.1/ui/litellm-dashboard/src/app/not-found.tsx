export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div>
        <p className="text-6xl font-semibold">404</p>
        <h1 className="mt-4 text-2xl font-semibold">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">请检查访问地址，或返回平台首页。</p>
        <a className="mt-6 inline-flex underline underline-offset-4" href="/ui/home/">返回平台首页</a>
      </div>
    </main>
  );
}
