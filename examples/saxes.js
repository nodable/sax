import { SaxesParser } from 'saxes';

// const xml = `<l0><l1><l2><l3><l4><l5><l6><l7><l8><l9></l9></l8></l7></l6></l5></l4></l3></l2></l1></l0>`;
const xml = `
<l0 attr='"' b=">'">a <self/> <![CDATA[<greeting>hey</greeting>]]> <!-- comment -->
    <l1>b
      <l2>c
        <l3>d
          <l4>e
            <l5>f
              <l6>g
                <l7>h
                  <l8>i
                    <l9>j</l9>
                  </l8>
                </l7>
              </l6>
            </l5>
          </l4>
        </l3>
      </l2>
    </l1>
  </l0>`;

// let ends = 0;
const p = new SaxesParser();
p.on("opentag", function (node) {
  console.log(JSON.stringify(node, null, 2));
});
p.on("error", function (e) {
  console.log(e);
});
// p.on('opentag', () => starts++);
// p.on('text', (text) => console.log(text));
// p.on('closetag', () => ends++);
p.on('cdata', (text) => console.log(text));
p.on('comment', (text) => console.log(text));

p.write(xml);
p.close();
